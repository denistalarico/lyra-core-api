import { randomUUID, createHash } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type FindOptionsWhere, Repository } from 'typeorm';
import { SocialContentDestinationEntity } from '../../social-planner/entities/social-content-destination.entity';
import { SocialContentItemEntity } from '../../social-planner/entities/social-content-item.entity';
import { SocialOrganicAssetEntity } from '../entities/social-organic-asset.entity';
import type { CreateSocialPublicationDto } from './dto/create-social-publication.dto';
import type { ListSocialPublicationsQueryDto } from './dto/list-social-publications.query.dto';
import { SocialPublicationEntity } from './entities/social-publication.entity';
import { canTransition } from './social-publication.state';

export interface SocialPublicationScope {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
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
  ) {}

  async list(
    scope: SocialPublicationScope,
    query: ListSocialPublicationsQueryDto,
  ) {
    const where: FindOptionsWhere<SocialPublicationEntity> = {
      ...this.scopeWhere(scope),
      ...(query.contentItemId ? { contentItemId: query.contentItemId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const items = await this.publicationsRepository.find({
      where,
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

    const scheduledAt = dto.scheduledAt
      ? new Date(dto.scheduledAt)
      : new Date();
    const payloadSnapshot = this.buildPayloadSnapshot(contentItem, destination);
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

    return this.publicationsRepository.save(publication);
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

    return this.publicationsRepository.save(retryPublication);
  }

  private buildPayloadSnapshot(
    contentItem: SocialContentItemEntity,
    destination: SocialContentDestinationEntity,
  ): Record<string, unknown> {
    return {
      placement: destination.placement,
      caption: contentItem.caption,
      copy: contentItem.copy,
      cta: contentItem.cta,
      hashtags: contentItem.hashtags,
      firstComment: contentItem.firstComment,
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
      where: { id: contentItemId, ...this.contentScopeWhere(scope) },
    });

    if (!item) {
      throw new NotFoundException('Social content item not found.');
    }

    return item;
  }

  private async requireDestination(
    scope: SocialPublicationScope,
    destinationId: string,
    contentItemId: string,
  ): Promise<SocialContentDestinationEntity> {
    const destination = await this.destinationsRepository.findOne({
      where: {
        id: destinationId,
        contentItemId,
        ...this.destinationScopeWhere(scope),
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
      where: { id: publicationId, ...this.scopeWhere(scope) },
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

  private contentScopeWhere(
    scope: SocialPublicationScope,
  ): FindOptionsWhere<SocialContentItemEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private destinationScopeWhere(
    scope: SocialPublicationScope,
  ): FindOptionsWhere<SocialContentDestinationEntity> {
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
    };
  }
}
