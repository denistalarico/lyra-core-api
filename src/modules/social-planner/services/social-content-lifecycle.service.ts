import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  IsNull,
  Not,
  type EntityManager,
  type FindOptionsWhere,
  Repository,
} from 'typeorm';
import {
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialDestinationCreativeEntity,
  SocialPlanEntity,
} from '../entities';
import { toSocialContentItemView } from '../views/social-planner.view';
import {
  SocialContentPublicationGuard,
  type SocialContentPublicationBlocker,
} from './content-publication-guard.port';
import { toCsvDocument, type CsvValue } from './social-content-csv';
import type { SocialPlannerScope } from './social-planner.service';

/**
 * The outcome of one item inside a batch.
 *
 * A batch never collapses to a single success flag. E6's rule is that a batch
 * must present a partial result rather than declare failure as success, so each
 * id carries its own verdict and its own reason, and the caller can act on the
 * three items that were refused without guessing which they were.
 *
 * `reason` is a closed vocabulary, not a message: the UI renders its own safe,
 * actionable text (§3), and an error string invented here would end up on
 * screen verbatim the first time someone forgot.
 */
export type SocialContentActionOutcome =
  | { contentId: string; status: 'ok' }
  | {
      contentId: string;
      status: 'failed';
      reason:
        | 'not_found'
        | 'already_archived'
        | 'not_archived'
        | 'has_publications'
        | 'guard_unavailable';
      /** Present only for `has_publications`, to explain what is in the way. */
      blockingStatuses?: string[];
    };

export type SocialContentBatchResult = {
  items: SocialContentActionOutcome[];
  succeeded: number;
  failed: number;
};

const COPY_SUFFIX = ' (cópia)';

/**
 * Title column is varchar(240); a duplicate of a duplicate must still fit.
 */
const TITLE_MAX_LENGTH = 240;

/**
 * Everything that removes, hides, restores or clones a Planner content item
 * (Planner E6).
 *
 * WHY THIS IS A SEPARATE SERVICE FROM `SocialPlannerService`
 * ---------------------------------------------------------
 * `SocialPlannerService` is already the largest surface in this module and its
 * methods share one shape: resolve scope, mutate editorial fields, return a
 * view. Lifecycle actions do not fit that shape. They reason about rows the
 * ordinary reads deliberately cannot see, they consult a foreign domain before
 * refusing, and every one of them is transactional across more than one table.
 * Keeping them apart means the visibility rules live in one file instead of
 * being a condition repeated across two dozen methods.
 *
 * WHAT "DELETE" MEANS HERE
 * ------------------------
 * It is a soft delete, and that is not a convenience. Publication rows point at
 * content items with `ON DELETE RESTRICT` and are immutable execution
 * evidence: a hard delete of anything that ever published would either be
 * refused by the database or orphan proof of a post that exists on a provider.
 * So the row stays, stops being listed, and the evidence keeps its referent.
 */
@Injectable()
export class SocialContentLifecycleService {
  constructor(
    @InjectRepository(SocialContentItemEntity, 'agency')
    private readonly contentRepository: Repository<SocialContentItemEntity>,

    /**
     * Deleting a plan is the same lifecycle question as deleting an item —
     * same guard, same soft-delete rule — so it lives here rather than in
     * `SocialPlannerService`, which would otherwise need the guard too.
     */
    @InjectRepository(SocialPlanEntity, 'agency')
    private readonly plansRepository: Repository<SocialPlanEntity>,

    @InjectRepository(SocialContentDestinationEntity, 'agency')
    private readonly destinationsRepository: Repository<SocialContentDestinationEntity>,

    @InjectRepository(SocialDestinationCreativeEntity, 'agency')
    private readonly creativesRepository: Repository<SocialDestinationCreativeEntity>,

    /**
     * Optional so the Planner still boots in a graph without `social-organic`.
     * That is not permission to skip the check: an unregistered guard makes
     * delete fail with `guard_unavailable`, never succeed unchecked.
     */
    @Optional()
    private readonly publicationGuard?: SocialContentPublicationGuard,
  ) {}

  // ------------------------------------------------------------- duplicate

  /**
   * Clones a content item into the same plan.
   *
   * WHAT IS COPIED AND WHAT IS NOT
   * ------------------------------
   * Copied: the editorial substance (title, theme, brief, key message, copy,
   * caption, script, CTA, hashtags, first comment), the classification, the
   * destinations, and the creative chosen for each destination.
   *
   * Not copied: revisions, publications, `currentRevisionId`, and the lifecycle
   * stamps. A duplicate has no history because it never had one — carrying a
   * revision chain across would make the new item claim edits nobody made to
   * it, and pointing `currentRevisionId` at the original's revision would tie
   * two items to a single mutable row.
   *
   * `plannedDate` and each destination's `plannedAt` ARE copied. A duplicate is
   * overwhelmingly made to publish something similar near the same moment, and
   * a copy that silently lost its date would look scheduled while sitting
   * nowhere on the calendar. Nothing is scheduled by this: a destination's
   * `plannedAt` is editorial intent, and no publication row is created.
   */
  async duplicate(
    scope: SocialPlannerScope,
    contentId: string,
    actorUserId: string | null,
  ) {
    const source = await this.requireVisibleContent(scope, contentId);

    const created = await this.contentRepository.manager.transaction(
      async (manager) => {
        const contentRepository = manager.getRepository(
          SocialContentItemEntity,
        );

        const clone = await contentRepository.save(
          contentRepository.create({
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            agencyClientId: scope.agencyClientId,

            planId: source.planId,
            title: this.buildCopyTitle(source.title),

            theme: source.theme,
            brief: source.brief,
            keyMessage: source.keyMessage,

            copy: source.copy,
            caption: source.caption,
            script: source.script,
            cta: source.cta,
            hashtags: [...source.hashtags],
            firstComment: source.firstComment,

            /** A clone starts with no history of its own. */
            currentRevisionId: null,

            funnelStage: source.funnelStage,
            contentType: source.contentType,
            objective: source.objective,
            creativeFormat: source.creativeFormat,

            planningStatus: source.planningStatus,
            plannedDate: source.plannedDate,
            sortOrder: source.sortOrder,

            campaignInstanceId: source.campaignInstanceId,
            editorialPillarId: source.editorialPillarId,

            archivedAt: null,
            archivedById: null,
            deletedAt: null,
            deletedById: null,

            createdById: actorUserId,
            updatedById: actorUserId,
          }),
        );

        await this.cloneDestinationsAndCreatives(manager, scope, {
          sourceContentId: source.id,
          targetContentId: clone.id,
          actorUserId,
        });

        return clone;
      },
    );

    const destinations = await this.destinationsRepository.find({
      where: {
        ...this.destinationScopeWhere(scope),
        contentItemId: created.id,
      },
      order: { channel: 'ASC', placement: 'ASC' },
    });

    return toSocialContentItemView(created, destinations);
  }

  /**
   * Copies destinations and, for each new destination, the creative the source
   * destination had.
   *
   * The creative is re-pointed at the newly created destination rather than
   * shared: `social_destination_creatives` has one primary row per destination,
   * enforced by a partial unique index, so a shared row is not representable.
   * The media itself is not copied — both items reference the same
   * `media_asset_id`, which is correct, because a duplicate is a second use of
   * the same file, not a second file.
   *
   * Capability is deliberately NOT rechecked here. The pair being copied
   * (`media_asset_id`, `organic_asset_id`) passed validation when it was
   * chosen, and the placement is copied along with it, so the tuple that was
   * checked is exactly the tuple being written. Re-running the check would add
   * a way for `duplicate` to fail halfway for a reason unrelated to
   * duplication, and the real protection is unchanged: schedule time validates
   * again before anything reaches a provider.
   */
  private async cloneDestinationsAndCreatives(
    manager: EntityManager,
    scope: SocialPlannerScope,
    input: {
      sourceContentId: string;
      targetContentId: string;
      actorUserId: string | null;
    },
  ): Promise<void> {
    const destinationRepository = manager.getRepository(
      SocialContentDestinationEntity,
    );
    const creativeRepository = manager.getRepository(
      SocialDestinationCreativeEntity,
    );

    const sourceDestinations = await destinationRepository.find({
      where: {
        ...this.destinationScopeWhere(scope),
        contentItemId: input.sourceContentId,
      },
      order: { channel: 'ASC', placement: 'ASC' },
    });

    if (sourceDestinations.length === 0) {
      return;
    }

    const sourceCreatives = await creativeRepository.find({
      where: {
        ...this.creativeScopeWhere(scope),
        contentItemId: input.sourceContentId,
      },
    });

    const creativesByDestination = new Map<
      string,
      SocialDestinationCreativeEntity[]
    >();

    for (const creative of sourceCreatives) {
      const bucket = creativesByDestination.get(creative.destinationId) ?? [];
      bucket.push(creative);
      creativesByDestination.set(creative.destinationId, bucket);
    }

    for (const sourceDestination of sourceDestinations) {
      const clonedDestination = await destinationRepository.save(
        destinationRepository.create({
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          contentItemId: input.targetContentId,
          channel: sourceDestination.channel,
          placement: sourceDestination.placement,
          plannedAt: sourceDestination.plannedAt,
        }),
      );

      const creatives = creativesByDestination.get(sourceDestination.id) ?? [];

      if (creatives.length === 0) {
        continue;
      }

      await creativeRepository.save(
        creatives.map((creative) =>
          creativeRepository.create({
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            agencyClientId: scope.agencyClientId,

            destinationId: clonedDestination.id,
            contentItemId: input.targetContentId,

            mediaAssetId: creative.mediaAssetId,
            organicAssetId: creative.organicAssetId,

            role: creative.role,
            sortOrder: creative.sortOrder,
            /**
             * Provenance is preserved rather than rewritten to `manual`: the
             * file really did come from wherever it came from, and a duplicate
             * does not change that. How the link was made is recorded by
             * `created_by_id` and `created_at` on the new row.
             */
            source: creative.source,

            createdById: input.actorUserId,
          }),
        ),
      );
    }
  }

  // --------------------------------------------------------------- archive

  async archive(
    scope: SocialPlannerScope,
    contentId: string,
    actorUserId: string | null,
  ) {
    const outcome = await this.archiveOne(scope, contentId, actorUserId);
    this.throwForSingleOutcome(outcome);

    return this.getViewOrThrow(scope, contentId);
  }

  async restore(
    scope: SocialPlannerScope,
    contentId: string,
    actorUserId: string | null,
  ) {
    const outcome = await this.restoreOne(scope, contentId, actorUserId);
    this.throwForSingleOutcome(outcome);

    return this.getViewOrThrow(scope, contentId);
  }

  async archiveMany(
    scope: SocialPlannerScope,
    contentIds: string[],
    actorUserId: string | null,
  ): Promise<SocialContentBatchResult> {
    return this.runBatch(contentIds, (contentId) =>
      this.archiveOne(scope, contentId, actorUserId),
    );
  }

  async restoreMany(
    scope: SocialPlannerScope,
    contentIds: string[],
    actorUserId: string | null,
  ): Promise<SocialContentBatchResult> {
    return this.runBatch(contentIds, (contentId) =>
      this.restoreOne(scope, contentId, actorUserId),
    );
  }

  // ---------------------------------------------------------------- delete

  async remove(
    scope: SocialPlannerScope,
    contentId: string,
    actorUserId: string | null,
  ): Promise<void> {
    const check = await this.checkPublications(scope, [contentId]);
    const outcome = await this.removeOne(scope, contentId, actorUserId, check);

    this.throwForSingleOutcome(outcome);
  }

  /**
   * Permanently discards an unscheduled calendar draft.
   *
   * This is deliberately separate from `remove`: ordinary Planner deletion is
   * a soft delete because a publication is execution evidence. A Calendar
   * draft that never produced a publication has no such evidence, and keeping
   * it as a hidden row after the operator presses Cancel only creates an
   * orphan. The same publication guard is still mandatory, both to protect a
   * race with scheduling and to make this endpoint safe if it is called twice.
   */
  async discard(
    scope: SocialPlannerScope,
    contentId: string,
  ): Promise<void> {
    const check = await this.checkPublications(scope, [contentId]);
    if (!check.available) {
      this.throwForSingleOutcome({
        contentId,
        status: 'failed',
        reason: 'guard_unavailable',
      });
      return;
    }

    const item = await this.findLiveContent(scope, contentId);
    if (!item) {
      this.throwForSingleOutcome({
        contentId,
        status: 'failed',
        reason: 'not_found',
      });
    }

    const blocker = check.blockers.get(contentId);
    if (blocker) {
      this.throwForSingleOutcome({
        contentId,
        status: 'failed',
        reason: 'has_publications',
        blockingStatuses: blocker.statuses,
      });
    }

    /**
     * The database cascades only Planner-owned draft relationships (revisions,
     * destinations, creatives and pending generation rows). A publication
     * uses ON DELETE RESTRICT and has already been ruled out above.
     */
    await this.contentRepository.delete({
      id: contentId,
      ...this.contentScopeWhere(scope),
      deletedAt: IsNull(),
    });
  }

  /**
   * Deletes a batch, asking the publication guard exactly once.
   *
   * One guard call for the whole batch, not one per item: the question is the
   * same shape either way and a 200-item batch would otherwise be 200
   * cross-domain round trips. The per-item verdict is still per item — the
   * guard returns which ids are blocked and each is refused on its own.
   */
  async removeMany(
    scope: SocialPlannerScope,
    contentIds: string[],
    actorUserId: string | null,
  ): Promise<SocialContentBatchResult> {
    const check = await this.checkPublications(scope, contentIds);

    return this.runBatch(contentIds, (contentId) =>
      this.removeOne(scope, contentId, actorUserId, check),
    );
  }

  /**
   * Soft-deletes a whole plan, with its content.
   *
   * WHY THE PLAN'S CONTENT IS CHECKED AND NOT JUST THE PLAN
   * ------------------------------------------------------
   * A plan owns nothing that publishes; its content items do. Deleting the
   * plan while any of them holds a live publication would hide the editorial
   * side of a post that a provider is still going to send, or already sent, and
   * leave the publication pointing at something no screen can reach. So the
   * same guard that protects a single delete is asked about every live item in
   * the plan, and one blocked item refuses the whole operation.
   *
   * ALL OR NOTHING, UNLIKE A CONTENT BATCH
   * --------------------------------------
   * `removeMany` reports a partial result because the operator picked those
   * items one by one and can act on the ones that were refused. Nobody picks
   * the contents of a plan — they picked the plan. A partial outcome there
   * would leave a deleted plan with some of its content still live and
   * reachable from the calendar, which is a state no screen in the Planner
   * knows how to show.
   *
   * The plan and its items are stamped in one transaction for the same reason:
   * a half-applied delete is exactly that unshowable state.
   */
  async removePlan(
    scope: SocialPlannerScope,
    planId: string,
    actorUserId: string | null,
  ): Promise<void> {
    const plan = await this.plansRepository.findOne({
      where: {
        id: planId,
        ...this.planScopeWhere(scope),
      },
    });

    if (!plan) {
      throw new NotFoundException('Social plan not found.');
    }

    /**
     * Live items only — archived ones included. An archived item is still the
     * plan's content and must go with it, while an already soft-deleted one
     * needs neither a guard question nor a second stamp.
     */
    const items = await this.contentRepository.find({
      where: {
        ...this.contentScopeWhere(scope),
        deletedAt: IsNull(),
        planId: plan.id,
      },
      select: { id: true },
    });

    const contentIds = items.map((item) => item.id);
    const check = await this.checkPublications(scope, contentIds);

    if (!check.available) {
      throw new ServiceUnavailableException(
        'Publication state cannot be verified right now.',
      );
    }

    const blockingStatuses = new Set<string>();

    for (const contentId of contentIds) {
      const blocker = check.blockers.get(contentId);

      if (blocker) {
        for (const status of blocker.statuses) {
          blockingStatuses.add(status);
        }
      }
    }

    if (blockingStatuses.size > 0) {
      throw new ConflictException({
        message:
          'Plan has content with publications and cannot be deleted from the Planner.',
        reason: 'has_publications',
        blockingStatuses: [...blockingStatuses].sort(),
      });
    }

    const deletedAt = new Date();

    await this.contentRepository.manager.transaction(async (manager) => {
      if (contentIds.length > 0) {
        await manager.getRepository(SocialContentItemEntity).update(
          {
            id: In(contentIds),
            ...this.contentScopeWhere(scope),
            deletedAt: IsNull(),
          },
          {
            deletedAt,
            deletedById: actorUserId,
            updatedById: actorUserId,
          },
        );
      }

      await manager.getRepository(SocialPlanEntity).update(
        {
          id: plan.id,
          ...this.planScopeWhere(scope),
        },
        {
          deletedAt,
          deletedById: actorUserId,
          updatedById: actorUserId,
        },
      );
    });
  }

  // -------------------------------------------------------- single actions

  private async archiveOne(
    scope: SocialPlannerScope,
    contentId: string,
    actorUserId: string | null,
  ): Promise<SocialContentActionOutcome> {
    const item = await this.findLiveContent(scope, contentId);

    if (!item) {
      return { contentId, status: 'failed', reason: 'not_found' };
    }

    if (item.archivedAt) {
      /**
       * Reported rather than silently accepted. In a batch an operator needs
       * to see that three of the twelve were already archived; treating it as
       * success would hide that the selection was stale.
       */
      return { contentId, status: 'failed', reason: 'already_archived' };
    }

    await this.contentRepository.update(
      {
        id: item.id,
        ...this.contentScopeWhere(scope),
        deletedAt: IsNull(),
        archivedAt: IsNull(),
      },
      {
        archivedAt: new Date(),
        archivedById: actorUserId,
        updatedById: actorUserId,
      },
    );

    return { contentId, status: 'ok' };
  }

  private async restoreOne(
    scope: SocialPlannerScope,
    contentId: string,
    actorUserId: string | null,
  ): Promise<SocialContentActionOutcome> {
    const item = await this.findLiveContent(scope, contentId);

    if (!item) {
      return { contentId, status: 'failed', reason: 'not_found' };
    }

    if (!item.archivedAt) {
      return { contentId, status: 'failed', reason: 'not_archived' };
    }

    await this.contentRepository.update(
      {
        id: item.id,
        ...this.contentScopeWhere(scope),
        deletedAt: IsNull(),
        archivedAt: Not(IsNull()),
      },
      {
        archivedAt: null,
        archivedById: null,
        updatedById: actorUserId,
      },
    );

    return { contentId, status: 'ok' };
  }

  /**
   * Soft-deletes one item, after the publication guard has spoken.
   *
   * The guard result is passed in rather than fetched here so a batch asks the
   * foreign domain once. An `available: false` check refuses every item: not
   * being able to ask whether a publication exists is not the same as there
   * being none.
   */
  private async removeOne(
    scope: SocialPlannerScope,
    contentId: string,
    actorUserId: string | null,
    check: Awaited<ReturnType<SocialContentPublicationGuard['check']>>,
  ): Promise<SocialContentActionOutcome> {
    if (!check.available) {
      return { contentId, status: 'failed', reason: 'guard_unavailable' };
    }

    const item = await this.findLiveContent(scope, contentId);

    if (!item) {
      return { contentId, status: 'failed', reason: 'not_found' };
    }

    const blocker: SocialContentPublicationBlocker | undefined =
      check.blockers.get(item.id);

    if (blocker) {
      return {
        contentId,
        status: 'failed',
        reason: 'has_publications',
        blockingStatuses: blocker.statuses,
      };
    }

    /**
     * Only the content item is stamped. Destinations and creatives are left
     * exactly as they are: their foreign keys CASCADE from the content item,
     * so they would follow a hard delete automatically, and for a soft delete
     * they must stay intact — a restored item with no destinations would be a
     * silent loss of editorial work. Every read of them is already reached
     * through a content item that this stamp now hides.
     */
    await this.contentRepository.update(
      {
        id: item.id,
        ...this.contentScopeWhere(scope),
        deletedAt: IsNull(),
      },
      {
        deletedAt: new Date(),
        deletedById: actorUserId,
        updatedById: actorUserId,
      },
    );

    return { contentId, status: 'ok' };
  }

  // ------------------------------------------------------------ export CSV

  /**
   * The plan's content as a spreadsheet-safe CSV (E6).
   *
   * WHAT IS EXPORTED
   * ----------------
   * The columns the Planning table shows, plus the destinations as one
   * summarizing text cell. Deliberately absent: `brief`, `copy`, `caption`,
   * `script` and `firstComment`. Those are the long-form editorial body, they
   * turn a table into something unreadable in a spreadsheet, and exporting the
   * full text of every post is a much larger disclosure than an operator
   * expects from a planning export. The Planner page itself remains the place
   * to read them.
   *
   * Media never appears in any form. Not the `storagePath`, which §3 forbids
   * outright, and not a URL either: a link in a CSV outlives the file's access
   * control the moment the sheet is shared.
   *
   * VISIBILITY MATCHES THE SCREEN
   * -----------------------------
   * The export takes the same `archived` selector as the listing, so what is
   * exported is what the operator was looking at. Soft-deleted rows are absent
   * from every variant.
   */
  async exportPlanContentCsv(
    scope: SocialPlannerScope,
    planId: string,
    archived: 'exclude' | 'include' | 'only' = 'exclude',
  ): Promise<string> {
    const items = await this.contentRepository.find({
      where: {
        ...this.contentScopeWhere(scope),
        deletedAt: IsNull(),
        planId,
        ...(archived === 'exclude' ? { archivedAt: IsNull() } : {}),
        ...(archived === 'only' ? { archivedAt: Not(IsNull()) } : {}),
      },
      order: { plannedDate: 'ASC', sortOrder: 'ASC', createdAt: 'ASC' },
    });

    const destinationsByContent = await this.loadDestinationsFor(
      scope,
      items.map((item) => item.id),
    );

    const rows: CsvValue[][] = [
      [
        'Título',
        'Data planejada',
        'Status editorial',
        'Etapa do funil',
        'Tipo de conteúdo',
        'Formato',
        'Objetivo',
        'Tema',
        'Mensagem-chave',
        'Hashtags',
        'CTA',
        'Destinos',
        'Arquivado em',
        'Criado em',
        'Atualizado em',
      ],
    ];

    for (const item of items) {
      const destinations = destinationsByContent.get(item.id) ?? [];

      rows.push([
        item.title,
        item.plannedDate,
        item.planningStatus,
        item.funnelStage,
        item.contentType,
        item.creativeFormat,
        item.objective,
        item.theme,
        item.keyMessage,
        item.hashtags.join(' '),
        item.cta,
        destinations
          .map(
            (destination) => `${destination.channel}:${destination.placement}`,
          )
          .join(' | '),
        item.archivedAt ? item.archivedAt.toISOString() : '',
        item.createdAt.toISOString(),
        item.updatedAt.toISOString(),
      ]);
    }

    return toCsvDocument(rows);
  }

  private async loadDestinationsFor(
    scope: SocialPlannerScope,
    contentIds: string[],
  ): Promise<Map<string, SocialContentDestinationEntity[]>> {
    const byContent = new Map<string, SocialContentDestinationEntity[]>();

    if (contentIds.length === 0) {
      return byContent;
    }

    const destinations = await this.destinationsRepository.find({
      where: {
        ...this.destinationScopeWhere(scope),
        contentItemId: In(contentIds),
      },
      order: { channel: 'ASC', placement: 'ASC' },
    });

    for (const destination of destinations) {
      const bucket = byContent.get(destination.contentItemId) ?? [];
      bucket.push(destination);
      byContent.set(destination.contentItemId, bucket);
    }

    return byContent;
  }

  // ------------------------------------------------------------- internals

  private async checkPublications(
    scope: SocialPlannerScope,
    contentIds: string[],
  ): Promise<Awaited<ReturnType<SocialContentPublicationGuard['check']>>> {
    if (!this.publicationGuard) {
      return { available: false };
    }

    return this.publicationGuard.check({ scope, contentItemIds: contentIds });
  }

  /**
   * Runs a batch item by item, in the order the caller sent.
   *
   * Sequential rather than concurrent: these are short writes against the same
   * few rows, and running them in parallel would trade a predictable result
   * order for lock contention on the same plan. No transaction spans the
   * batch — a partial result is the contract, so one refused item must not
   * roll back the eleven that succeeded.
   */
  private async runBatch(
    contentIds: string[],
    run: (contentId: string) => Promise<SocialContentActionOutcome>,
  ): Promise<SocialContentBatchResult> {
    const items: SocialContentActionOutcome[] = [];

    /** A repeated id is answered once and echoed, never acted on twice. */
    const seen = new Map<string, SocialContentActionOutcome>();

    for (const contentId of contentIds) {
      const previous = seen.get(contentId);

      if (previous) {
        items.push(previous);
        continue;
      }

      const outcome = await run(contentId);
      seen.set(contentId, outcome);
      items.push(outcome);
    }

    const succeeded = items.filter((item) => item.status === 'ok').length;

    return {
      items,
      succeeded,
      failed: items.length - succeeded,
    };
  }

  /**
   * Turns a single-item outcome into the HTTP shape.
   *
   * `not_found` for an item another tenant owns, never a 403: existence is not
   * revealed. `guard_unavailable` is a 503 rather than a 409 because nothing
   * about the request is wrong — the server temporarily cannot answer, and a
   * retry is the right response.
   */
  private throwForSingleOutcome(outcome: SocialContentActionOutcome): void {
    if (outcome.status === 'ok') {
      return;
    }

    switch (outcome.reason) {
      case 'not_found':
        throw new NotFoundException('Social content item not found.');

      case 'guard_unavailable':
        throw new ServiceUnavailableException(
          'Publication state cannot be verified right now.',
        );

      case 'has_publications':
        throw new ConflictException({
          message:
            'Content item has publications and cannot be deleted from the Planner.',
          reason: 'has_publications',
          blockingStatuses: outcome.blockingStatuses ?? [],
        });

      case 'already_archived':
        throw new ConflictException('Content item is already archived.');

      case 'not_archived':
        throw new ConflictException('Content item is not archived.');
    }
  }

  private async getViewOrThrow(scope: SocialPlannerScope, contentId: string) {
    const item = await this.findLiveContent(scope, contentId);

    if (!item) {
      throw new NotFoundException('Social content item not found.');
    }

    const destinations = await this.destinationsRepository.find({
      where: {
        ...this.destinationScopeWhere(scope),
        contentItemId: item.id,
      },
      order: { channel: 'ASC', placement: 'ASC' },
    });

    return toSocialContentItemView(item, destinations);
  }

  /**
   * A content item that has not been soft-deleted, archived or not.
   *
   * Archived rows are reachable here on purpose: restore and delete both act on
   * them. Soft-deleted rows are not reachable by anything in this service —
   * once deleted, an item answers `not_found` to every action, including a
   * second delete.
   */
  private async findLiveContent(
    scope: SocialPlannerScope,
    contentId: string,
  ): Promise<SocialContentItemEntity | null> {
    return this.contentRepository.findOne({
      where: {
        id: contentId,
        ...this.contentScopeWhere(scope),
        deletedAt: IsNull(),
      },
    });
  }

  private async requireVisibleContent(
    scope: SocialPlannerScope,
    contentId: string,
  ): Promise<SocialContentItemEntity> {
    const item = await this.findLiveContent(scope, contentId);

    if (!item) {
      throw new NotFoundException('Social content item not found.');
    }

    return item;
  }

  /**
   * Appends the copy marker, trimming the original title rather than the
   * marker when the result would exceed the column.
   *
   * Losing the end of a long title is recoverable — the operator renames it.
   * Losing the marker would produce two identically named rows in the same
   * plan, which is the one outcome duplication must not create.
   */
  private buildCopyTitle(title: string): string {
    const candidate = `${title}${COPY_SUFFIX}`;

    if (candidate.length <= TITLE_MAX_LENGTH) {
      return candidate;
    }

    const room = TITLE_MAX_LENGTH - COPY_SUFFIX.length;

    return `${title.slice(0, room).trimEnd()}${COPY_SUFFIX}`;
  }

  private contentScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialContentItemEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  /**
   * Carries `deletedAt IS NULL` — unlike `contentScopeWhere` above, whose call
   * sites choose their own visibility because restore and the archived listing
   * legitimately need to reach hidden rows. Nothing restores a plan, so there
   * is no read here that should ever see a deleted one.
   */
  private planScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialPlanEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      deletedAt: IsNull(),
    };
  }

  private destinationScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialContentDestinationEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private creativeScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialDestinationCreativeEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }
}
