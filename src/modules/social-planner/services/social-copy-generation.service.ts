import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  In,
  IsNull,
  LessThanOrEqual,
  type EntityManager,
  type FindOptionsWhere,
  Repository,
} from 'typeorm';
import type {
  AcceptSocialCopyProposalsDto,
  RequestSocialCopyGenerationBatchDto,
  RequestSocialCopyGenerationDto,
} from '../dto';
import {
  SOCIAL_COPY_GENERATION_FIELDS,
  SocialCampaignInstanceEntity,
  SocialContentDestinationEntity,
  SocialContentItemEntity,
  SocialContentRevisionEntity,
  SocialCopyGenerationProposalEntity,
  SocialCopyGenerationRunEntity,
  SocialEditorialPillarEntity,
  SocialPlanEntity,
  type SocialCopyGenerationField,
  type SocialCopyGenerationRunStatus,
} from '../entities';
import {
  toColumnField,
  toSocialCopyGenerationProposalView,
  toSocialCopyGenerationRunView,
  type SocialCopyGenerationProposalView,
  type SocialCopyGenerationRunView,
} from '../views/social-copy-generation.view';
import { toSocialContentItemView } from '../views/social-planner.view';
import { SocialCopyGenerationConfigService } from './social-copy-generation-config.service';
import {
  buildCopyGenerationContext,
  defaultFieldsFor,
  SOCIAL_COPY_CONTEXT_VERSION,
} from './social-copy-generation-context';
import { SocialCopyGenerationStateMachine } from './social-copy-generation-state-machine';
import { SocialCopyGenerationError } from './social-copy-generation.errors';
import { SocialPlannerSettingsService } from './social-planner-settings.service';
import type { SocialPlannerScope } from './social-planner.service';

/**
 * The outcome of one item inside a fan-out generation request.
 *
 * Deliberately the same shape E6 established for lifecycle batches: a closed
 * `reason` vocabulary, never a message, because the UI writes the sentence and
 * an error string invented here would reach the screen verbatim the first time
 * someone forgot. A batch never collapses into a single success flag.
 */
export type SocialCopyGenerationOutcome =
  | { contentId: string; status: 'ok'; runId: string }
  | {
      contentId: string;
      status: 'failed';
      reason:
        | 'not_found'
        | 'already_running'
        | 'archived'
        | 'generation_disabled'
        | 'budget_exhausted'
        | 'limit_exceeded';
    };

export type SocialCopyGenerationBatchResult = {
  items: SocialCopyGenerationOutcome[];
  succeeded: number;
  failed: number;
};

/**
 * What the worker needs to execute one run, resolved in the run's own scope.
 */
export interface ResolvedGenerationWork {
  run: SocialCopyGenerationRunEntity;
  context: string;
  contextVersion: string;
  fields: Array<{
    field: SocialCopyGenerationField;
    currentValue: string | string[] | null;
  }>;
  instruction: string | null;
}

/**
 * Copy generation for the Planner (E8).
 *
 * WHY THIS IS A SEPARATE SERVICE
 * ------------------------------
 * `SocialPlannerService` is already the largest surface in this module and its
 * methods share one shape: resolve scope, mutate editorial fields, return a
 * view. Generation does not fit it. It owns a queue, it is the only thing here
 * that reaches an external paid provider, and its whole point is that its
 * output is *not* applied until a human says so. Keeping it apart is the same
 * reasoning E6 used for `SocialContentLifecycleService`.
 *
 * WHAT THIS SERVICE WILL NOT DO
 * -----------------------------
 * It never writes generated text onto a content item. Enqueue stages a run; the
 * worker stages proposals; only `acceptProposals` touches content, and it does
 * so by creating a revision with `source: 'ai'` and the run id — the provenance
 * contract that was already waiting on `social_content_revisions`.
 *
 * SCOPE IS NEVER TAKEN FROM A BODY
 * --------------------------------
 * Every query filters resource and scope simultaneously, with
 * `agencyClientId === null ? IsNull() : value`, because a raw `null` is not a
 * safe TypeORM filter. That rule is §3 of the handoff and it is why the scope
 * helpers below exist rather than being inlined per query.
 */
@Injectable()
export class SocialCopyGenerationService {
  constructor(
    @InjectRepository(SocialCopyGenerationRunEntity, 'agency')
    private readonly runsRepository: Repository<SocialCopyGenerationRunEntity>,

    @InjectRepository(SocialCopyGenerationProposalEntity, 'agency')
    private readonly proposalsRepository: Repository<SocialCopyGenerationProposalEntity>,

    @InjectRepository(SocialContentItemEntity, 'agency')
    private readonly contentRepository: Repository<SocialContentItemEntity>,

    @InjectRepository(SocialContentDestinationEntity, 'agency')
    private readonly destinationsRepository: Repository<SocialContentDestinationEntity>,

    @InjectRepository(SocialPlanEntity, 'agency')
    private readonly plansRepository: Repository<SocialPlanEntity>,

    @InjectRepository(SocialCampaignInstanceEntity, 'agency')
    private readonly campaignsRepository: Repository<SocialCampaignInstanceEntity>,

    @InjectRepository(SocialEditorialPillarEntity, 'agency')
    private readonly pillarsRepository: Repository<SocialEditorialPillarEntity>,

    private readonly settingsService: SocialPlannerSettingsService,
    private readonly config: SocialCopyGenerationConfigService,
    private readonly stateMachine: SocialCopyGenerationStateMachine,
  ) {}

  /**
   * Enqueues one run for one content item.
   *
   * Throws rather than returning an outcome, because a single-item request has
   * an HTTP status available to say what happened. The batch path translates the
   * same conditions into its closed vocabulary instead.
   */
  async requestForContent(
    scope: SocialPlannerScope,
    contentId: string,
    actorUserId: string | null,
    dto: RequestSocialCopyGenerationDto,
  ): Promise<SocialCopyGenerationRunView> {
    this.assertEnabled();

    const item = await this.contentRepository.findOne({
      where: { id: contentId, ...this.contentScopeWhere(scope) },
    });
    if (!item) throw new NotFoundException('Social content item not found.');

    if (item.archivedAt)
      throw new ConflictException(
        'Archived content cannot be sent for generation.',
      );

    await this.assertWithinDailyBudget(scope);

    const existing = await this.findInFlightRun(scope, item.id);
    if (existing) {
      /**
       * Not an error. A second click on a button whose first click is still
       * running wants the run that exists, not a second paid call — and the
       * partial unique index would refuse the insert anyway.
       */
      return toSocialCopyGenerationRunView(existing);
    }

    const run = await this.insertRun(
      scope,
      item,
      actorUserId,
      'content_copy',
      dto,
    );
    return toSocialCopyGenerationRunView(run);
  }

  /**
   * Enqueues one run per item in an explicit selection.
   *
   * Each id is revalidated in the caller's scope. Items the caller cannot see
   * come back as `not_found` rather than being skipped silently: a selection
   * that crossed a context boundary is something the operator needs told.
   */
  async requestForSelection(
    scope: SocialPlannerScope,
    actorUserId: string | null,
    dto: RequestSocialCopyGenerationBatchDto,
  ): Promise<SocialCopyGenerationBatchResult> {
    this.assertEnabled();
    return this.fanOut(
      scope,
      dto.contentIds,
      actorUserId,
      'selection_copy',
      dto,
    );
  }

  /**
   * Enqueues runs for the live, non-archived content of one plan.
   *
   * Capped by `maxItemsPerRequest`: a plan-wide generation is a paid call per
   * item, so an unbounded plan is an unbounded bill. Items past the cap are
   * reported as `limit_exceeded` rather than dropped, so the operator can see
   * that the request was trimmed and run the rest deliberately.
   */
  async requestForPlan(
    scope: SocialPlannerScope,
    planId: string,
    actorUserId: string | null,
    dto: RequestSocialCopyGenerationDto,
  ): Promise<SocialCopyGenerationBatchResult> {
    this.assertEnabled();

    const plan = await this.plansRepository.findOne({
      where: { id: planId, ...this.planScopeWhere(scope) },
    });
    if (!plan) throw new NotFoundException('Social plan not found.');

    const items = await this.contentRepository.find({
      where: {
        planId: plan.id,
        archivedAt: IsNull(),
        ...this.contentScopeWhere(scope),
      },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    return this.fanOut(
      scope,
      items.map((item) => item.id),
      actorUserId,
      'plan_copy',
      dto,
    );
  }

  private async fanOut(
    scope: SocialPlannerScope,
    contentIds: string[],
    actorUserId: string | null,
    runKind: 'plan_copy' | 'selection_copy',
    dto: RequestSocialCopyGenerationDto,
  ): Promise<SocialCopyGenerationBatchResult> {
    const unique = [...new Set(contentIds)];
    const allowed = unique.slice(0, this.config.maxItemsPerRequest);
    const trimmed = unique.slice(this.config.maxItemsPerRequest);

    const items =
      allowed.length > 0
        ? await this.contentRepository.find({
            where: { id: In(allowed), ...this.contentScopeWhere(scope) },
          })
        : [];

    const byId = new Map(items.map((item) => [item.id, item]));
    const outcomes: SocialCopyGenerationOutcome[] = [];

    /**
     * The budget is read once per request, then charged per enqueued run. A
     * per-item re-read would be a query per item to answer a question whose
     * answer only moves when a run actually completes.
     */
    let budgetAvailable = await this.dailyBudgetRemaining(scope);

    for (const contentId of allowed) {
      const item = byId.get(contentId);
      if (!item) {
        outcomes.push({ contentId, status: 'failed', reason: 'not_found' });
        continue;
      }

      if (item.archivedAt) {
        outcomes.push({ contentId, status: 'failed', reason: 'archived' });
        continue;
      }

      if (budgetAvailable < this.config.reserveCents) {
        outcomes.push({
          contentId,
          status: 'failed',
          reason: 'budget_exhausted',
        });
        continue;
      }

      const existing = await this.findInFlightRun(scope, item.id);
      if (existing) {
        outcomes.push({
          contentId,
          status: 'failed',
          reason: 'already_running',
        });
        continue;
      }

      try {
        const run = await this.insertRun(
          scope,
          item,
          actorUserId,
          runKind,
          dto,
        );
        budgetAvailable -= this.config.reserveCents;
        outcomes.push({ contentId, status: 'ok', runId: run.id });
      } catch {
        /**
         * The partial unique index is the authority on "one live run per item".
         * Losing that race is exactly the `already_running` case, reported the
         * same way as the checked one so the caller sees one vocabulary.
         */
        outcomes.push({
          contentId,
          status: 'failed',
          reason: 'already_running',
        });
      }
    }

    for (const contentId of trimmed)
      outcomes.push({ contentId, status: 'failed', reason: 'limit_exceeded' });

    return {
      items: outcomes,
      succeeded: outcomes.filter((outcome) => outcome.status === 'ok').length,
      failed: outcomes.filter((outcome) => outcome.status === 'failed').length,
    };
  }

  private async insertRun(
    scope: SocialPlannerScope,
    item: SocialContentItemEntity,
    actorUserId: string | null,
    runKind: 'content_copy' | 'plan_copy' | 'selection_copy',
    dto: RequestSocialCopyGenerationDto,
  ): Promise<SocialCopyGenerationRunEntity> {
    const attempt = await this.runsRepository.count({
      where: { contentItemId: item.id, ...this.runScopeWhere(scope) },
    });

    const instruction = dto.instruction?.trim() ? dto.instruction.trim() : null;

    return this.runsRepository.save(
      this.runsRepository.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        planId: item.planId,
        contentItemId: item.id,
        runKind,
        idempotencyKey: `planner-copy:${item.id}:${attempt + 1}`,
        status: 'queued',
        maxAttempts: this.config.maxAttempts,
        /**
         * An explicit field list is frozen here because it is the requester's
         * decision. An omitted list stays NULL so the worker derives it from the
         * item as it is when the prompt is built, not as it was when the button
         * was pressed.
         */
        requestedFields:
          dto.fields && dto.fields.length > 0 ? [...dto.fields] : null,
        instruction,
        /**
         * Recorded at enqueue because the builder version is a property of the
         * code that will run, and `provider`/`model`/`promptVersion` stay NULL
         * until a call actually returns.
         */
        contextVersion: SOCIAL_COPY_CONTEXT_VERSION,
        requestedById: actorUserId,
      }),
    );
  }

  /** Lists the runs for one content item, newest first, with their proposals. */
  async listForContent(
    scope: SocialPlannerScope,
    contentId: string,
  ): Promise<{
    runs: SocialCopyGenerationRunView[];
    proposals: SocialCopyGenerationProposalView[];
    providerEnabled: boolean;
  }> {
    const item = await this.contentRepository.findOne({
      where: { id: contentId, ...this.contentScopeWhere(scope) },
    });
    if (!item) throw new NotFoundException('Social content item not found.');

    const runs = await this.runsRepository.find({
      where: { contentItemId: item.id, ...this.runScopeWhere(scope) },
      order: { createdAt: 'DESC' },
    });

    const proposals = await this.proposalsRepository.find({
      where: { contentItemId: item.id, ...this.proposalScopeWhere(scope) },
      order: { createdAt: 'DESC' },
    });

    return {
      runs: runs.map(toSocialCopyGenerationRunView),
      proposals: proposals.map(toSocialCopyGenerationProposalView),
      /**
       * Lets the UI disable the action with an explanation instead of offering a
       * button that always fails — which is what the E4 registro anticipated.
       */
      providerEnabled: this.config.mode !== 'disabled',
    };
  }

  async getRun(
    scope: SocialPlannerScope,
    runId: string,
  ): Promise<{
    run: SocialCopyGenerationRunView;
    proposals: SocialCopyGenerationProposalView[];
  }> {
    const run = await this.runsRepository.findOne({
      where: { id: runId, ...this.runScopeWhere(scope) },
    });
    if (!run) throw new NotFoundException('Generation run not found.');

    const proposals = await this.proposalsRepository.find({
      where: { runId: run.id, ...this.proposalScopeWhere(scope) },
      order: { createdAt: 'ASC' },
    });

    return {
      run: toSocialCopyGenerationRunView(run),
      proposals: proposals.map(toSocialCopyGenerationProposalView),
    };
  }

  /**
   * Cancels a run the operator no longer wants.
   *
   * A `processing` run cannot recall its HTTP request, so cancelling means its
   * result will be discarded instead of staged — the worker re-reads the row
   * before writing proposals and finds it terminal. The provider call is sunk
   * cost either way; the operator's intent (do not change my content) is still
   * honoured, which is the part that matters.
   */
  async cancelRun(
    scope: SocialPlannerScope,
    runId: string,
  ): Promise<SocialCopyGenerationRunView> {
    return this.runsRepository.manager.transaction(async (manager) => {
      const repository = manager.getRepository(SocialCopyGenerationRunEntity);

      const run = await repository.findOne({
        where: { id: runId, ...this.runScopeWhere(scope) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!run) throw new NotFoundException('Generation run not found.');

      if (this.stateMachine.isTerminal(run.status))
        throw new ConflictException(
          'This generation run has already finished.',
        );

      run.status = 'cancelled';
      run.cancelledAt = new Date();
      run.lockedAt = null;
      run.lockedBy = null;

      const saved = await repository.save(run);
      return toSocialCopyGenerationRunView(saved);
    });
  }

  /**
   * Applies chosen proposals to the content item, as one revision.
   *
   * THIS IS THE ONLY PATH FROM GENERATED TEXT TO CONTENT
   * ---------------------------------------------------
   * E8 requires that a result is reviewed before it replaces anything and that
   * accepting records provenance. So one transaction: re-read the item under a
   * write lock, refuse if the base moved, create exactly one revision carrying
   * `source: 'ai'` and the run id, and mark the proposals accepted with the
   * revision that applied them.
   *
   * ONE REVISION, NOT ONE PER FIELD
   * -------------------------------
   * A revision is a snapshot of all six fields, and `revisionNumber` is
   * sequential per content item. Writing one per accepted field would produce
   * several snapshots describing a single editorial decision and make the
   * history unreadable.
   */
  async acceptProposals(
    scope: SocialPlannerScope,
    contentId: string,
    actorUserId: string | null,
    dto: AcceptSocialCopyProposalsDto,
  ) {
    return this.runsRepository.manager.transaction(async (manager) => {
      const contentRepository = manager.getRepository(SocialContentItemEntity);
      const proposalsRepository = manager.getRepository(
        SocialCopyGenerationProposalEntity,
      );
      const revisionsRepository = manager.getRepository(
        SocialContentRevisionEntity,
      );

      const item = await contentRepository.findOne({
        where: { id: contentId, ...this.contentScopeWhere(scope) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) throw new NotFoundException('Social content item not found.');

      const proposals = await proposalsRepository.find({
        where: {
          id: In(dto.proposalIds),
          contentItemId: item.id,
          ...this.proposalScopeWhere(scope),
        },
      });

      if (proposals.length !== dto.proposalIds.length)
        throw new NotFoundException('Generation proposal not found.');

      const pending = proposals.filter(
        (proposal) => proposal.status === 'pending',
      );
      if (pending.length !== proposals.length)
        throw new ConflictException('Only pending proposals can be accepted.');

      /**
       * All accepted proposals must come from one run, so the revision can name
       * a single `generationRunId`. Mixing runs would make provenance a guess.
       */
      const runIds = new Set(pending.map((proposal) => proposal.runId));
      if (runIds.size > 1)
        throw new BadRequestException(
          'Proposals from different generation runs cannot be accepted together.',
        );

      if (!dto.overrideChangedBase) {
        const moved = pending.filter((proposal) =>
          this.baseHasChanged(item, proposal),
        );
        if (moved.length > 0)
          throw new ConflictException(
            'This content changed after the generation ran.',
          );
      }

      const next = {
        copy: item.copy,
        caption: item.caption,
        script: item.script,
        cta: item.cta,
        hashtags: item.hashtags,
        firstComment: item.firstComment,
      };

      for (const proposal of pending) {
        const field = proposal.field;
        if (field === 'hashtags') {
          next.hashtags = Array.isArray(proposal.value)
            ? (proposal.value as unknown[]).filter(
                (entry): entry is string => typeof entry === 'string',
              )
            : next.hashtags;
          continue;
        }

        if (typeof proposal.value !== 'string') continue;

        if (field === 'copy') next.copy = proposal.value;
        else if (field === 'caption') next.caption = proposal.value;
        else if (field === 'script') next.script = proposal.value;
        else if (field === 'cta') next.cta = proposal.value;
        else if (field === 'first_comment') next.firstComment = proposal.value;
      }

      const latestRevision = await revisionsRepository.findOne({
        where: {
          ...this.revisionScopeWhere(scope),
          contentItemId: item.id,
        },
        order: { revisionNumber: 'DESC' },
      });

      /**
       * `ai_then_human` would claim the operator edited the text, which this
       * path does not do — it accepts verbatim. A later manual edit creates its
       * own revision through the existing `createRevision`, which is where that
       * source belongs.
       */
      const revision = await revisionsRepository.save(
        revisionsRepository.create({
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId: scope.agencyClientId,
          contentItemId: item.id,
          revisionNumber: (latestRevision?.revisionNumber ?? 0) + 1,
          copy: next.copy,
          caption: next.caption,
          script: next.script,
          cta: next.cta,
          hashtags: next.hashtags,
          firstComment: next.firstComment,
          briefSnapshot: item.brief,
          source: 'ai',
          parentRevisionId: item.currentRevisionId,
          generationRunId: [...runIds][0] ?? null,
          createdById: actorUserId,
        }),
      );

      item.copy = revision.copy;
      item.caption = revision.caption;
      item.script = revision.script;
      item.cta = revision.cta;
      item.hashtags = revision.hashtags;
      item.firstComment = revision.firstComment;
      item.currentRevisionId = revision.id;
      item.updatedById = actorUserId;

      const savedContent = await contentRepository.save(item);

      const decidedAt = new Date();
      await proposalsRepository.update(
        { id: In(pending.map((proposal) => proposal.id)) },
        {
          status: 'accepted',
          appliedRevisionId: revision.id,
          decidedById: actorUserId,
          decidedAt,
        },
      );

      return {
        content: toSocialContentItemView(savedContent),
        revisionId: revision.id,
        acceptedProposalIds: pending.map((proposal) => proposal.id),
      };
    });
  }

  /**
   * Rejects proposals without touching the content.
   *
   * Rejected rows are kept rather than deleted: "the agency looked at this and
   * said no" is the useful half of the audit trail, and deleting it would make
   * a rejected run indistinguishable from one that produced nothing.
   */
  async rejectProposals(
    scope: SocialPlannerScope,
    contentId: string,
    actorUserId: string | null,
    proposalIds: string[],
  ): Promise<{ rejectedProposalIds: string[] }> {
    const item = await this.contentRepository.findOne({
      where: { id: contentId, ...this.contentScopeWhere(scope) },
    });
    if (!item) throw new NotFoundException('Social content item not found.');

    const proposals = await this.proposalsRepository.find({
      where: {
        id: In(proposalIds),
        contentItemId: item.id,
        status: 'pending',
        ...this.proposalScopeWhere(scope),
      },
    });

    if (proposals.length === 0)
      throw new NotFoundException('Generation proposal not found.');

    await this.proposalsRepository.update(
      { id: In(proposals.map((proposal) => proposal.id)) },
      { status: 'rejected', decidedById: actorUserId, decidedAt: new Date() },
    );

    return { rejectedProposalIds: proposals.map((proposal) => proposal.id) };
  }

  /**
   * Builds everything the worker needs for one run, in the run's own scope.
   *
   * The worker holds a run id and nothing else, so this is where a run becomes a
   * prompt. It reads the item live: a run queued twenty minutes ago must be
   * built from the content as it is now, not as it was.
   */
  async resolveWork(
    run: SocialCopyGenerationRunEntity,
  ): Promise<ResolvedGenerationWork> {
    const scope: SocialPlannerScope = {
      tenantId: run.tenantId,
      workspaceId: run.workspaceId,
      agencyClientId: run.agencyClientId,
    };

    const item = await this.contentRepository.findOne({
      where: { id: run.contentItemId, ...this.contentScopeWhere(scope) },
    });
    if (!item) throw new SocialCopyGenerationError('content_not_available');

    const plan = await this.plansRepository.findOne({
      where: { id: item.planId, ...this.planScopeWhere(scope) },
    });
    if (!plan) throw new SocialCopyGenerationError('plan_not_available');

    const destinations = await this.destinationsRepository.find({
      where: {
        contentItemId: item.id,
        ...this.destinationScopeWhere(scope),
      },
      order: { plannedAt: 'ASC' },
    });

    const { settings } = await this.settingsService.getSettings(scope);

    const campaign = item.campaignInstanceId
      ? await this.campaignsRepository.findOne({
          where: {
            id: item.campaignInstanceId,
            ...this.campaignScopeWhere(scope),
          },
        })
      : null;

    const pillar = item.editorialPillarId
      ? await this.pillarsRepository.findOne({
          where: {
            id: item.editorialPillarId,
            ...this.pillarScopeWhere(scope),
          },
        })
      : null;

    /**
     * A persisted list is filtered against the closed field vocabulary before
     * use. The CHECK constraint only proves the column holds an array, so a row
     * written by anything other than this service cannot widen what gets asked
     * of the provider.
     */
    const requested = (run.requestedFields ?? []).filter(
      (field): field is SocialCopyGenerationField =>
        SOCIAL_COPY_GENERATION_FIELDS.includes(
          field as SocialCopyGenerationField,
        ),
    );

    const fields =
      requested.length > 0
        ? requested
        : defaultFieldsFor(item, destinations, settings);

    return {
      run,
      context: buildCopyGenerationContext(
        {
          plan,
          item,
          destinations,
          settings,
          campaignTitle: campaign ? campaign.name : null,
          pillarName: pillar ? pillar.label : null,
        },
        this.config.maxContextChars,
      ),
      contextVersion: SOCIAL_COPY_CONTEXT_VERSION,
      fields: fields.map((field) => ({
        field,
        currentValue: this.currentValueOf(item, field),
      })),
      instruction: run.instruction,
    };
  }

  /**
   * Stages the provider's output, and supersedes whatever the previous run for
   * the same field still had pending.
   *
   * Without superseding, an operator who generated twice would be shown two
   * competing proposals for one caption with nothing saying which is newer.
   */
  async recordProposals(
    manager: EntityManager,
    run: SocialCopyGenerationRunEntity,
    proposals: Array<{
      field: SocialCopyGenerationField;
      value: string | string[];
      baseValue: string | string[] | null;
      rationale: string | null;
    }>,
  ): Promise<void> {
    if (proposals.length === 0) return;

    const repository = manager.getRepository(
      SocialCopyGenerationProposalEntity,
    );
    const columnFields = proposals.map((proposal) =>
      toColumnField(proposal.field),
    );

    await repository
      .createQueryBuilder()
      .update(SocialCopyGenerationProposalEntity)
      .set({ status: 'superseded' })
      .where('content_item_id = :contentItemId', {
        contentItemId: run.contentItemId,
      })
      .andWhere('tenant_id = :tenantId', { tenantId: run.tenantId })
      .andWhere('workspace_id = :workspaceId', { workspaceId: run.workspaceId })
      .andWhere('status = :status', { status: 'pending' })
      .andWhere('field IN (:...fields)', { fields: columnFields })
      .execute();

    await repository.save(
      proposals.map((proposal) =>
        repository.create({
          tenantId: run.tenantId,
          workspaceId: run.workspaceId,
          agencyClientId: run.agencyClientId,
          runId: run.id,
          contentItemId: run.contentItemId,
          field: toColumnField(proposal.field),
          value: proposal.value,
          baseValue: proposal.baseValue,
          rationale: proposal.rationale,
          status: 'pending',
        }),
      ),
    );
  }

  /**
   * Sums today's recorded cost for the scope, so the budget is derived from the
   * runs themselves rather than tracked in a counter table that could drift —
   * same "derive, don't duplicate" choice as the briefing quota service.
   */
  async dailyBudgetRemaining(scope: SocialPlannerScope): Promise<number> {
    if (this.config.dailyBudgetCents === 0) return Number.MAX_SAFE_INTEGER;

    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);

    const raw = await this.runsRepository
      .createQueryBuilder('run')
      .select('COALESCE(SUM(run.costCents), 0)', 'total')
      .where('run.tenantId = :tenantId', { tenantId: scope.tenantId })
      .andWhere('run.workspaceId = :workspaceId', {
        workspaceId: scope.workspaceId,
      })
      .andWhere('run.createdAt >= :since', { since })
      .getRawOne<{ total: string }>();

    const spent = Number(raw?.total ?? 0);
    return Math.max(0, this.config.dailyBudgetCents - spent);
  }

  async findClaimableRunIds(limit: number, now: Date = new Date()) {
    return this.runsRepository.find({
      where: {
        status: 'queued' as SocialCopyGenerationRunStatus,
        availableAt: LessThanOrEqual(now),
        lockedAt: IsNull(),
      },
      take: Math.max(1, limit),
    });
  }

  private async assertWithinDailyBudget(
    scope: SocialPlannerScope,
  ): Promise<void> {
    const remaining = await this.dailyBudgetRemaining(scope);
    if (remaining < this.config.reserveCents)
      throw new ServiceUnavailableException(
        'The daily AI generation budget for this context has been reached.',
      );
  }

  private assertEnabled(): void {
    if (this.config.mode === 'disabled')
      throw new ServiceUnavailableException(
        'AI copy generation is not enabled for this deployment.',
      );
  }

  private async findInFlightRun(
    scope: SocialPlannerScope,
    contentItemId: string,
  ): Promise<SocialCopyGenerationRunEntity | null> {
    return this.runsRepository.findOne({
      where: {
        contentItemId,
        status: In(['queued', 'processing']),
        ...this.runScopeWhere(scope),
      },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Compares the stored base against the field's live value.
   *
   * Normalizing both sides through the same shape means an empty string and a
   * NULL are not reported as a conflict — they are the same editorial state and
   * refusing there would block an accept for no reason the operator could see.
   */
  private baseHasChanged(
    item: SocialContentItemEntity,
    proposal: SocialCopyGenerationProposalEntity,
  ): boolean {
    const field = proposal.field;
    const live = this.currentValueOf(
      item,
      field === 'first_comment'
        ? 'firstComment'
        : (field as SocialCopyGenerationField),
    );

    const base = proposal.baseValue;

    if (Array.isArray(live) || Array.isArray(base)) {
      const liveArray = Array.isArray(live) ? live : [];
      const baseArray = Array.isArray(base)
        ? base.filter((entry): entry is string => typeof entry === 'string')
        : [];
      return (
        liveArray.length !== baseArray.length ||
        liveArray.some((entry, index) => entry !== baseArray[index])
      );
    }

    return (live ?? '') !== (typeof base === 'string' ? base : '');
  }

  private currentValueOf(
    item: SocialContentItemEntity,
    field: SocialCopyGenerationField,
  ): string | string[] | null {
    switch (field) {
      case 'copy':
        return item.copy;
      case 'caption':
        return item.caption;
      case 'script':
        return item.script;
      case 'cta':
        return item.cta;
      case 'hashtags':
        return item.hashtags;
      case 'firstComment':
        return item.firstComment;
      default:
        return null;
    }
  }

  private runScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialCopyGenerationRunEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private proposalScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialCopyGenerationProposalEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  /**
   * `deletedAt: IsNull()` belongs inside the scope helper, not in each query —
   * E6's reasoning, which this service inherits: a soft-deleted item that
   * reappears is a silent failure, so forgetting the condition must not be the
   * default mode.
   */
  private contentScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialContentItemEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      deletedAt: IsNull(),
    };
  }

  private planScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialPlanEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
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

  private campaignScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialCampaignInstanceEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private pillarScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialEditorialPillarEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private revisionScopeWhere(
    scope: SocialPlannerScope,
  ): FindOptionsWhere<SocialContentRevisionEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }
}
