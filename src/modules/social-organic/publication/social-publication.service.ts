import { randomUUID, createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Raw, type FindOptionsWhere, Repository } from 'typeorm';
import { MediaAssetResolverService } from '../../../common/media-assets';
import { checkMediaAssetCapability } from '../media/media-capability-check';
import { SocialContentDestinationEntity } from '../../social-planner/entities/social-content-destination.entity';
import { SocialContentItemEntity } from '../../social-planner/entities/social-content-item.entity';
import { SocialOrganicAssetEntity } from '../entities/social-organic-asset.entity';
import { SocialPublisherRegistry } from '../providers/social-publisher.registry';
import type { CreateSocialPublicationDto } from './dto/create-social-publication.dto';
import type { ListSocialPublicationsQueryDto } from './dto/list-social-publications.query.dto';
import { SocialPublicationEntity } from './entities/social-publication.entity';
import { SocialPublicationMediaEntity } from './entities/social-publication-media.entity';
import { canTransition } from './social-publication.state';

export interface SocialPublicationScope {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId?: string | null;
}

const DEFAULT_MAX_ATTEMPTS = 5;

/** Everything the publication controller needs to create, schedule, cancel, list and retry. */
@Injectable()
export class SocialPublicationService {
  constructor(
    @InjectRepository(SocialPublicationEntity, 'agency')
    private readonly publicationsRepository: Repository<SocialPublicationEntity>,

    @InjectRepository(SocialContentItemEntity, 'agency')
    private readonly contentRepository: Repository<SocialContentItemEntity>,

    @InjectRepository(SocialContentDestinationEntity, 'agency')
    private readonly destinationsRepository: Repository<SocialContentDestinationEntity>,

    @InjectRepository(SocialOrganicAssetEntity, 'agency')
    private readonly assetsRepository: Repository<SocialOrganicAssetEntity>,

    private readonly mediaAssetResolver: MediaAssetResolverService,

    private readonly publisherRegistry: SocialPublisherRegistry,
  ) {}

  async list(
    scope: SocialPublicationScope,
    query: ListSocialPublicationsQueryDto,
  ) {
    const items = await this.publicationsRepository.find({
      where: {
        ...this.companyScopedPublicationWhere(scope),
        ...(query.contentItemId ? { contentItemId: query.contentItemId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      order: { scheduledAt: 'DESC', createdAt: 'DESC' },
    });

    return { items, total: items.length };
  }

  async get(scope: SocialPublicationScope, publicationId: string) {
    return this.requirePublication(scope, publicationId);
  }

  /**
   * Schedules a new publication. `payload_snapshot` is built here, server-side,
   * from the content item as it stands right now — never taken from the
   * request (T-rule: a caller cannot smuggle a different caption past what an
   * editor approved).
   */
  async create(
    scope: SocialPublicationScope,
    actorUserId: string | null,
    dto: CreateSocialPublicationDto,
  ): Promise<SocialPublicationEntity> {
    const contentItem = await this.requireContentItem(scope, dto.contentItemId);
    const destination = await this.requireDestination(
      scope,
      dto.destinationId,
      contentItem.id,
    );
    const asset = await this.requirePublishableAsset(scope, dto.assetId);
    if (dto.mediaAssetId && dto.mediaAssetIds?.length) {
      throw new BadRequestException('Choose mediaAssetId or mediaAssetIds, not both.');
    }
    const mediaAssetIds = dto.mediaAssetIds?.length
      ? [...new Set(dto.mediaAssetIds)]
      : dto.mediaAssetId
        ? [dto.mediaAssetId]
        : [];
    if (mediaAssetIds.length > 10) {
      throw new BadRequestException('A publication supports at most 10 media assets.');
    }
    if (mediaAssetIds.length !== (dto.mediaAssetIds?.length ?? mediaAssetIds.length)) {
      throw new BadRequestException('Duplicate media assets are not supported.');
    }
    const mediaAssetId = mediaAssetIds[0] ?? null;

    for (const candidateMediaAssetId of mediaAssetIds) {
      // Schedule-time (P3.1): resolves scope and validates the asset against
      // the destination provider's declared capabilities *before* persisting
      // anything. The storage location itself never enters payload_snapshot
      // or any other persisted column — only the validated reference does.
      await this.validateMediaAssetOrThrow({
        scope,
        mediaAssetId: candidateMediaAssetId,
        provider: asset.provider,
        assetType: asset.assetType,
        placement: destination.placement,
      });
    }

    const scheduledAt = dto.scheduledAt
      ? new Date(dto.scheduledAt)
      : new Date();
    const payloadSnapshot = this.buildPayloadSnapshot(
      contentItem,
      destination,
      mediaAssetIds,
    );
    const payloadHash = this.hashPayload(payloadSnapshot);
    const idempotencyKey = randomUUID();

    const publication = this.publicationsRepository.create({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      contentItemId: contentItem.id,
      destinationId: destination.id,
      provider: asset.provider,
      connectionId: asset.connectionId,
      assetId: asset.id,
      externalAssetId: asset.externalAssetId,
      mediaAssetId,
      status: 'scheduled',
      scheduledAt,
      publishedAt: null,
      externalPublicationId: null,
      externalPermalink: null,
      payloadSnapshot,
      payloadHash,
      idempotencyKey,
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      availableAt: scheduledAt,
      lockedAt: null,
      lockedBy: null,
      lastErrorCode: null,
      failureReason: null,
      providerMetadata: {},
      createdById: actorUserId,
      cancelledById: null,
      cancelledAt: null,
    });

    return this.saveWithMedia(publication, mediaAssetIds);
  }

  /**
   * Brings a `scheduled` publication's due time forward to now, so the next
   * scheduler tick releases it into the queue immediately. This never moves
   * the row itself into `queued` — only the scheduler and worker touch the
   * lease columns (§10.4: queue/worker ownership stays with `P2`).
   */
  async publishNow(
    scope: SocialPublicationScope,
    publicationId: string,
  ): Promise<SocialPublicationEntity> {
    const publication = await this.requirePublication(scope, publicationId);

    if (publication.status !== 'scheduled') {
      throw new ConflictException(
        `Only a scheduled publication can be published now (current status "${publication.status}").`,
      );
    }

    const now = new Date();
    publication.scheduledAt = now;
    publication.availableAt = now;

    return this.publicationsRepository.save(publication);
  }

  /**
   * Moves a publication that has not started running (E6).
   *
   * WHY ONLY `scheduled`
   * --------------------
   * `queued` and `processing` mean the scheduler has already released the row
   * and a worker may hold, or be about to hold, a lease on it. Changing
   * `available_at` under a lease is how the same post gets published twice. The
   * later states are terminal. So `scheduled` is the only status where moving
   * the time is meaningful, and anything else is a 409 telling the operator to
   * cancel and create a new publication instead.
   *
   * WHY A CONDITIONAL UPDATE AND NOT A SAVE
   * ---------------------------------------
   * Read-then-save loses the race it is trying to win: between the read and the
   * write, the scheduler can move the row to `queued` and the save would
   * happily overwrite it. The `update` below carries the whole precondition —
   * status still `scheduled`, no lease held — into the WHERE clause, so
   * PostgreSQL decides the winner and an affected-row count of zero is the
   * concurrent-loss signal. That is the same lease discipline the sync queue
   * already uses, applied to the one operator action that can collide with it.
   *
   * `availableAt` moves with `scheduledAt` because they mean the same thing for
   * a row that has not run yet: the earliest instant it may be picked up. They
   * are separate columns only so that a retry can back a row off without
   * rewriting the operator's intended time, which is not what is happening
   * here.
   *
   * `payloadSnapshot`, `payloadHash` and `idempotencyKey` are deliberately
   * untouched. The payload did not change, and rotating the idempotency key
   * would discard the protection that stops a provider retry from posting
   * twice — a reschedule moves when the same post goes out, not what it is.
   *
   * A TIME IN THE PAST IS ACCEPTED
   * ------------------------------
   * The scheduler releases on `scheduled_at <= now`, so a past instant means
   * "at the next tick" — the same outcome as `publishNow`. It is not rejected,
   * because the alternative punishes the honest case: an operator moving a post
   * to a minute from now would lose to their own clock skew and see a
   * validation error for a request that was correct when they sent it. The UI
   * is the right place to warn that a past time publishes immediately.
   */
  async reschedule(
    scope: SocialPublicationScope,
    publicationId: string,
    scheduledAt: Date,
  ): Promise<SocialPublicationEntity> {
    const publication = await this.requirePublication(scope, publicationId);

    if (publication.status !== 'scheduled') {
      throw new ConflictException(
        `Only a scheduled publication can be rescheduled (current status "${publication.status}").`,
      );
    }

    const result = await this.publicationsRepository.update(
      {
        id: publication.id,
        ...this.scopeWhere(scope),
        status: 'scheduled',
        lockedAt: IsNull(),
        lockedBy: IsNull(),
      },
      {
        scheduledAt,
        availableAt: scheduledAt,
      },
    );

    if (!result.affected) {
      /**
       * Someone else won. The row moved out of `scheduled` or acquired a lease
       * between the read above and this write, which is exactly the case E6
       * asks to answer with a conflict rather than a silent overwrite.
       */
      throw new ConflictException(
        'Publication changed state while being rescheduled.',
      );
    }

    return this.requirePublication(scope, publication.id);
  }

  /** Cancels a publication still waiting to run. Legality is the state machine's call, not this method's. */
  async cancel(
    scope: SocialPublicationScope,
    actorUserId: string | null,
    publicationId: string,
  ): Promise<SocialPublicationEntity> {
    const publication = await this.requirePublication(scope, publicationId);

    if (!canTransition(publication.status, 'cancelled')) {
      throw new ConflictException(
        `Publication cannot be cancelled from status "${publication.status}".`,
      );
    }

    publication.status = 'cancelled';
    publication.cancelledById = actorUserId;
    publication.cancelledAt = new Date();

    return this.publicationsRepository.save(publication);
  }

  /**
   * A `failed` publication is terminal (§10.3) — it is never reopened.
   * Retrying means a new attempt row against the same destination, with its
   * own idempotency key, so the audit trail keeps every attempt intact
   * (blueprint §10.1: "N per destination — retries, reposts").
   */
  async retry(
    scope: SocialPublicationScope,
    actorUserId: string | null,
    publicationId: string,
  ): Promise<SocialPublicationEntity> {
    const original = await this.requirePublication(scope, publicationId);

    if (original.status !== 'failed') {
      throw new ConflictException(
        `Only a failed publication can be retried (current status "${original.status}").`,
      );
    }

    const originalMediaAssetIds = this.extractMediaAssetIds(
      original.payloadSnapshot,
      original.mediaAssetId,
    );
    if (originalMediaAssetIds.length) {
      // A new attempt row re-validates media at schedule time too (P3.1):
      // the asset or the provider's declared capabilities may have changed
      // since the original attempt was created or since it failed.
      const asset = await this.requirePublishableAsset(scope, original.assetId);
      for (const mediaAssetId of originalMediaAssetIds) {
        await this.validateMediaAssetOrThrow({
          scope,
          mediaAssetId,
          provider: asset.provider,
          assetType: asset.assetType,
          placement: this.extractPlacement(original.payloadSnapshot),
        });
      }
    }

    const scheduledAt = new Date();
    const retryPublication = this.publicationsRepository.create({
      tenantId: original.tenantId,
      workspaceId: original.workspaceId,
      agencyClientId: original.agencyClientId,
      contentItemId: original.contentItemId,
      destinationId: original.destinationId,
      provider: original.provider,
      connectionId: original.connectionId,
      assetId: original.assetId,
      externalAssetId: original.externalAssetId,
      mediaAssetId: original.mediaAssetId,
      status: 'scheduled',
      scheduledAt,
      publishedAt: null,
      externalPublicationId: null,
      externalPermalink: null,
      payloadSnapshot: original.payloadSnapshot,
      payloadHash: original.payloadHash,
      idempotencyKey: randomUUID(),
      attempts: 0,
      maxAttempts: original.maxAttempts,
      availableAt: scheduledAt,
      lockedAt: null,
      lockedBy: null,
      lastErrorCode: null,
      failureReason: null,
      providerMetadata: {},
      createdById: actorUserId,
      cancelledById: null,
      cancelledAt: null,
    });

    return this.saveWithMedia(retryPublication, originalMediaAssetIds);
  }

  /**
   * Removes only a failed local attempt that never reached the provider.
   *
   * A `failed` status alone is insufficient: a provider may have accepted a
   * post before a later step failed, so an external identifier is a permanent
   * execution record. The conditional delete carries all safety preconditions
   * to SQL and prevents a stale UI from widening the operation.
   */
  async deleteFailed(
    scope: SocialPublicationScope,
    publicationId: string,
  ): Promise<void> {
    const publication = await this.requirePublication(scope, publicationId);
    if (publication.status !== 'failed' || publication.externalPublicationId) {
      throw new ConflictException(
        'Only a failed publication without an external publication can be deleted.',
      );
    }

    const result = await this.publicationsRepository.delete({
      id: publication.id,
      ...this.scopeWhere(scope),
      status: 'failed',
      externalPublicationId: IsNull(),
    });
    if (!result.affected) {
      throw new ConflictException('Publication changed before it was deleted.');
    }
  }

  /**
   * Schedule-time media validation (P3.1): resolves the `mediaAssetId`
   * against trusted scope, resolves the destination provider's adapter and
   * declared capabilities for the asset type, and runs M1
   * (`checkMediaAssetCapability`) — the same check
   * `SocialPublicationExecutorService` runs at execution time. Rejects
   * before any row is persisted; never generates a presigned URL, never
   * calls M3 or the adapter's `prepareMedia`/`publish`.
   *
   * Throws `NotFoundException` for an out-of-scope/deleted asset (existence
   * is never revealed) and `BadRequestException('media_rejected')` for a
   * capability mismatch, incomplete metadata, or an unregistered provider —
   * the same closed `SocialPublicationFailureReason` vocabulary the executor
   * uses, never a raw M1 issue list or provider/registry detail.
   */
  private async validateMediaAssetOrThrow(input: {
    scope: SocialPublicationScope;
    mediaAssetId: string;
    provider: string;
    assetType: string;
    placement: string;
  }): Promise<void> {
    const resolvedMedia = await this.mediaAssetResolver.resolve({
      tenantId: input.scope.tenantId,
      workspaceId: input.scope.workspaceId,
      agencyClientId: input.scope.agencyClientId,
      mediaAssetId: input.mediaAssetId,
    });

    if (!this.publisherRegistry.has(input.provider, input.assetType)) {
      // Fail closed rather than let an unregistered-provider error escape
      // as an unmapped 500 (T-rule: stable, safe error surface).
      throw new BadRequestException('media_rejected');
    }

    const adapter = this.publisherRegistry.resolve(
      input.provider,
      input.assetType,
    );
    const capabilities = adapter.capabilities(input.assetType);

    const capabilityCheck = checkMediaAssetCapability(
      resolvedMedia,
      capabilities,
      input.placement,
    );

    if (!capabilityCheck.valid) {
      throw new BadRequestException('media_rejected');
    }
  }

  private extractPlacement(payloadSnapshot: unknown): string {
    const snapshot = payloadSnapshot as { placement?: unknown } | null;
    return typeof snapshot?.placement === 'string' ? snapshot.placement : '';
  }

  private extractMediaAssetIds(snapshotValue: unknown, fallback: string | null): string[] {
    const snapshot = snapshotValue as { mediaAssetIds?: unknown } | null;
    const ids = Array.isArray(snapshot?.mediaAssetIds)
      ? snapshot.mediaAssetIds.filter((value): value is string => typeof value === 'string')
      : [];
    return ids.length ? ids : fallback ? [fallback] : [];
  }

  private saveWithMedia(
    publication: SocialPublicationEntity,
    mediaAssetIds: string[],
  ): Promise<SocialPublicationEntity> {
    return this.publicationsRepository.manager.transaction(async (manager) => {
      const saved = await manager.getRepository(SocialPublicationEntity).save(publication);
      if (mediaAssetIds.length) {
        const mediaRepository = manager.getRepository(SocialPublicationMediaEntity);
        await mediaRepository.save(mediaAssetIds.map((mediaAssetId, index) => mediaRepository.create({
          publicationId: saved.id,
          mediaAssetId,
          role: mediaAssetIds.length > 1 ? 'slide' : 'primary',
          sortOrder: index,
        })));
      }
      return saved;
    });
  }

  private buildPayloadSnapshot(
    contentItem: SocialContentItemEntity,
    destination: SocialContentDestinationEntity,
    mediaAssetIds: string[],
  ): Record<string, unknown> {
    return {
      placement: destination.placement,
      caption: contentItem.caption,
      copy: contentItem.copy,
      cta: contentItem.cta,
      hashtags: contentItem.hashtags,
      firstComment: contentItem.firstComment,
      // Reference only — never storagePath or a presigned URL (§7 rule 2).
      mediaAssetId: mediaAssetIds[0] ?? null,
      mediaAssetIds,
    };
  }

  private hashPayload(payload: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }

  private async requireContentItem(
    scope: SocialPublicationScope,
    contentItemId: string,
  ): Promise<SocialContentItemEntity> {
    const item = await this.contentRepository.findOne({
      where: {
        id: contentItemId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
        deletedAt: IsNull(),
        planId: this.companyScopedPlanId(scope),
      },
    });

    if (!item) {
      throw new NotFoundException('Social content item not found.');
    }

    return item;
  }

  /**
   * The connected accounts this scope may actually publish to (E3).
   *
   * The composer needs `provider` and `assetType` to resolve which capability
   * applies, and those live on the connected asset, not on the editorial
   * destination — a destination's `channel` is intent ("instagram"), while a
   * workspace may have several connected Instagram accounts.
   *
   * Filtered by exactly the rule `requirePublishableAsset` enforces at
   * schedule time: `status === 'active'` and `isPublishEnabled`. If this
   * listed anything looser, the composer would offer a destination that
   * `create()` then refuses with a 409 the operator cannot act on.
   */
  async listPublishTargets(
    scope: SocialPublicationScope,
  ): Promise<SocialOrganicAssetEntity[]> {
    return this.assetsRepository.find({
      where: {
        ...this.assetScopeWhere(scope),
        status: 'active',
        isPublishEnabled: true,
      },
      order: { createdAt: 'ASC' },
    });
  }

  private async requireDestination(
    scope: SocialPublicationScope,
    destinationId: string,
    contentItemId: string,
  ): Promise<SocialContentDestinationEntity> {
    const destination = await this.destinationsRepository.findOne({
      where: {
        id: destinationId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
        contentItemId: Raw(
          (alias) =>
            `${alias} = :contentItemId AND EXISTS (` +
            `SELECT 1 FROM social_content_items item ` +
            `JOIN social_plans plan ON plan.id = item.plan_id ` +
            `WHERE item.id = ${alias} ` +
            `AND plan.company_context_id IS NOT DISTINCT FROM :companyContextId)`,
          {
            contentItemId,
            companyContextId: scope.companyContextId ?? null,
          },
        ),
      },
    });

    if (!destination) {
      throw new NotFoundException('Social content destination not found.');
    }

    return destination;
  }

  private async requirePublishableAsset(
    scope: SocialPublicationScope,
    assetId: string,
  ): Promise<SocialOrganicAssetEntity> {
    const asset = await this.assetsRepository.findOne({
      where: { id: assetId, ...this.assetScopeWhere(scope) },
    });

    if (!asset) {
      throw new NotFoundException('Social organic asset not found.');
    }

    if (asset.status !== 'active' || !asset.isPublishEnabled) {
      throw new ConflictException('Social organic asset is not publishable.');
    }

    return asset;
  }

  private async requirePublication(
    scope: SocialPublicationScope,
    publicationId: string,
  ): Promise<SocialPublicationEntity> {
    const publication = await this.publicationsRepository.findOne({
      where: {
        id: publicationId,
        ...this.companyScopedPublicationWhere(scope),
      },
    });

    if (!publication) {
      throw new NotFoundException('Social publication not found.');
    }

    return publication;
  }

  private scopeWhere(
    scope: SocialPublicationScope,
  ): FindOptionsWhere<SocialPublicationEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private assetScopeWhere(
    scope: SocialPublicationScope,
  ): FindOptionsWhere<SocialOrganicAssetEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      companyContextId:
        scope.companyContextId == null ? IsNull() : scope.companyContextId,
    };
  }

  private companyScopedPublicationWhere(
    scope: SocialPublicationScope,
  ): FindOptionsWhere<SocialPublicationEntity> {
    return {
      ...this.scopeWhere(scope),
      asset: {
        companyContextId:
          scope.companyContextId == null ? IsNull() : scope.companyContextId,
      },
      contentItem: { planId: this.companyScopedPlanId(scope) },
    };
  }

  private companyScopedPlanId(scope: SocialPublicationScope) {
    return Raw(
      (alias) =>
        `EXISTS (SELECT 1 FROM social_plans plan ` +
        `WHERE plan.id = ${alias} ` +
        `AND plan.company_context_id IS NOT DISTINCT FROM :companyContextId)`,
      { companyContextId: scope.companyContextId ?? null },
    );
  }
}
