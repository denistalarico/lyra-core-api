import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, type FindOptionsWhere, Repository } from 'typeorm';
import { MediaAssetEntity } from '../../../common/media-assets';
import { SocialContentDestinationEntity } from '../../social-planner/entities/social-content-destination.entity';
import { SocialContentItemEntity } from '../../social-planner/entities/social-content-item.entity';
import { SocialDestinationCreativeEntity } from '../../social-planner/entities/social-destination-creative.entity';
import {
  toSocialDestinationCreativeView,
  type SocialDestinationCreativeView,
} from '../../social-planner/views/social-destination-creative.view';
import { SocialOrganicAssetEntity } from '../entities/social-organic-asset.entity';
import { checkMediaAssetCapability } from '../media/media-capability-check';
import { SocialPublisherRegistry } from '../providers/social-publisher.registry';
import type { ReplaceDestinationCreativeDto } from './dto/replace-destination-creative.dto';

export interface DestinationCreativeScope {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
}

/** The only role this campaign's publication contract can actually execute. */
const PRIMARY_ROLE = 'primary';

/**
 * Binds a private-bucket media to an editorial destination (Planner E5).
 *
 * WHY THIS SERVICE LIVES IN `social-organic` AND NOT IN THE PLANNER
 * ----------------------------------------------------------------
 * The link itself is Planner data — the entity, the migration and the view all
 * belong to `social-planner`, which owns the destination. Choosing a creative,
 * however, is not a purely editorial act: it must be validated against the
 * declared capabilities of a concrete connected account, and both the
 * capability matrix (`SocialPublisherRegistry`) and the account
 * (`SocialOrganicAssetEntity`) live here.
 *
 * The module arrow across this pair already points one way —
 * `SocialOrganicModule` imports Planner entities and `SocialPublicationService`
 * resolves Planner destinations, while nothing in `social-planner` imports
 * `social-organic`. Putting this service in the Planner would invert that arrow
 * and create a module cycle. So the rule the existing code already follows is
 * kept: Planner owns the editorial rows, Organic owns anything that must reason
 * about a provider.
 *
 * WHY CAPABILITY IS CHECKED HERE AND AGAIN AT PUBLICATION
 * ------------------------------------------------------
 * This check is not a substitute for the one in `SocialPublicationService`.
 * Weeks may pass between choosing a creative and scheduling it, and a
 * provider's declared capabilities, the account's status, or the asset's own
 * metadata can change in between. Validating here gives the operator an
 * actionable error at the moment they can still fix it; validating again at
 * schedule time is what actually protects the queue. Both fail closed, and
 * neither trusts the other's verdict.
 */
@Injectable()
export class DestinationCreativeService {
  constructor(
    @InjectRepository(SocialDestinationCreativeEntity, 'agency')
    private readonly creativesRepository: Repository<SocialDestinationCreativeEntity>,

    @InjectRepository(SocialContentDestinationEntity, 'agency')
    private readonly destinationsRepository: Repository<SocialContentDestinationEntity>,

    @InjectRepository(SocialContentItemEntity, 'agency')
    private readonly contentRepository: Repository<SocialContentItemEntity>,

    @InjectRepository(MediaAssetEntity, 'agency')
    private readonly mediaAssetsRepository: Repository<MediaAssetEntity>,

    @InjectRepository(SocialOrganicAssetEntity, 'agency')
    private readonly organicAssetsRepository: Repository<SocialOrganicAssetEntity>,

    private readonly publisherRegistry: SocialPublisherRegistry,
  ) {}

  /**
   * Every creative chosen across one content item's destinations.
   *
   * Scoped by the content item first: proving the item belongs to the caller
   * before reading anything hung off it means an out-of-scope id answers "not
   * found" instead of "empty list", which would otherwise confirm that the id
   * exists somewhere.
   */
  async listForContent(
    scope: DestinationCreativeScope,
    contentId: string,
  ): Promise<{
    items: SocialDestinationCreativeView[];
    total: number;
  }> {
    await this.requireContent(scope, contentId);

    const creatives = await this.creativesRepository.find({
      where: {
        ...this.creativeScopeWhere(scope),
        contentItemId: contentId,
      },
      order: {
        destinationId: 'ASC',
        sortOrder: 'ASC',
        createdAt: 'ASC',
      },
    });

    const mediaById = await this.loadMediaAssets(
      scope,
      creatives.map((creative) => creative.mediaAssetId),
    );

    return {
      items: creatives.map((creative) =>
        toSocialDestinationCreativeView(
          creative,
          mediaById.get(creative.mediaAssetId) ?? null,
        ),
      ),
      total: creatives.length,
    };
  }

  /**
   * Sets the primary creative of one destination, replacing whatever was
   * there.
   *
   * Replacement rather than insert: the schema allows exactly one primary row
   * per destination, and an operator swapping a file is the normal case. The
   * delete and the insert share a transaction so a failed insert cannot leave
   * the destination with no creative at all.
   *
   * The previous row is deleted, not archived. It carried no execution
   * evidence — any publication already created from it holds its own
   * `media_asset_id` snapshot, protected by its own RESTRICT foreign key, and
   * is untouched by this. Editorial intent is mutable; execution evidence is
   * not, and they are different rows precisely so this delete is safe.
   */
  async replaceForDestination(
    scope: DestinationCreativeScope,
    destinationId: string,
    actorUserId: string | null,
    dto: ReplaceDestinationCreativeDto,
  ): Promise<SocialDestinationCreativeView> {
    const role = dto.role ?? PRIMARY_ROLE;

    if (role !== PRIMARY_ROLE) {
      /**
       * The schema reserves other roles for a future multi-media contract, but
       * the publication contract persists a single `mediaAssetId` and no
       * declared capability accepts a carousel. Accepting a `slide` today would
       * record an intent nothing can execute.
       */
      throw new BadRequestException(
        'Only a primary creative is supported for a destination.',
      );
    }

    const destination = await this.requireDestination(scope, destinationId);
    const organicAsset = await this.requirePublishableAsset(
      scope,
      dto.organicAssetId,
    );

    const mediaAsset = await this.requireMediaAsset(scope, dto.mediaAssetId);

    this.assertCapabilityOrThrow({
      mediaAsset,
      organicAsset,
      placement: destination.placement,
    });

    const saved = await this.creativesRepository.manager.transaction(
      async (manager) => {
        const repository = manager.getRepository(
          SocialDestinationCreativeEntity,
        );

        await repository.delete({
          ...this.creativeScopeWhere(scope),
          destinationId: destination.id,
          role: PRIMARY_ROLE,
        });

        return repository.save(
          repository.create({
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            agencyClientId: scope.agencyClientId,

            destinationId: destination.id,
            /** Derived from the resolved destination, never from the body. */
            contentItemId: destination.contentItemId,

            mediaAssetId: mediaAsset.id,
            organicAssetId: organicAsset.id,

            role: PRIMARY_ROLE,
            sortOrder: dto.sortOrder ?? 0,
            source: dto.source ?? 'manual',

            createdById: actorUserId,
          }),
        );
      },
    );

    return toSocialDestinationCreativeView(saved, mediaAsset);
  }

  /** Clears a destination's creative. Never touches publication evidence. */
  async removeForDestination(
    scope: DestinationCreativeScope,
    destinationId: string,
  ): Promise<void> {
    const destination = await this.requireDestination(scope, destinationId);

    await this.creativesRepository.delete({
      ...this.creativeScopeWhere(scope),
      destinationId: destination.id,
    });
  }

  /**
   * Runs the same fail-closed capability check the publication path runs.
   *
   * Errors are deliberately coarse: a caller learns the file was rejected for
   * this placement, never which rule it broke, which provider was resolved or
   * whether an adapter is registered. Those details describe our provider
   * wiring, not the operator's file. An unregistered adapter is a rejection
   * rather than a 500, matching `SocialPublicationService`'s handling exactly.
   *
   * Synchronous on purpose: every input has already been resolved and the
   * capability declaration is static data. Nothing here touches the database
   * or a provider, and marking it async would suggest otherwise.
   */
  private assertCapabilityOrThrow(input: {
    mediaAsset: MediaAssetEntity;
    organicAsset: SocialOrganicAssetEntity;
    placement: string;
  }): void {
    const { organicAsset } = input;

    if (
      !this.publisherRegistry.has(organicAsset.provider, organicAsset.assetType)
    ) {
      throw new BadRequestException('media_rejected');
    }

    const capabilities = this.publisherRegistry
      .resolve(organicAsset.provider, organicAsset.assetType)
      .capabilities(organicAsset.assetType);

    /**
     * The persisted metadata is reused as-is, exactly as
     * `checkMediaAssetCapability` requires — never re-extracted and never
     * defaulted. An asset with no usable dimensions fails there, closed.
     */
    const result = checkMediaAssetCapability(
      {
        id: input.mediaAsset.id,
        storagePath: input.mediaAsset.storagePath,
        mimeType: input.mediaAsset.mimeType,
        byteSize: input.mediaAsset.byteSize,
        width: input.mediaAsset.width,
        height: input.mediaAsset.height,
        durationMs: input.mediaAsset.durationMs,
        codec: input.mediaAsset.codec,
      },
      capabilities,
      input.placement,
    );

    if (!result.valid) {
      throw new BadRequestException('media_rejected');
    }
  }

  private async requireContent(
    scope: DestinationCreativeScope,
    contentId: string,
  ): Promise<SocialContentItemEntity> {
    const item = await this.contentRepository.findOne({
      where: { id: contentId, ...this.contentScopeWhere(scope) },
    });

    if (!item) {
      throw new NotFoundException('Social content item not found.');
    }

    return item;
  }

  private async requireDestination(
    scope: DestinationCreativeScope,
    destinationId: string,
  ): Promise<SocialContentDestinationEntity> {
    const destination = await this.destinationsRepository.findOne({
      where: { id: destinationId, ...this.destinationScopeWhere(scope) },
    });

    if (!destination) {
      throw new NotFoundException('Social content destination not found.');
    }

    return destination;
  }

  /**
   * Resolved through this service's own scoped repository rather than through
   * `MediaAssetResolverService`, because the capability check needs the full
   * row and the view needs its display fields. The scope rule is identical:
   * an asset in another tenant, workspace or client context resolves the same
   * as one that does not exist.
   */
  private async requireMediaAsset(
    scope: DestinationCreativeScope,
    mediaAssetId: string,
  ): Promise<MediaAssetEntity> {
    const asset = await this.mediaAssetsRepository.findOne({
      where: { id: mediaAssetId, ...this.mediaScopeWhere(scope) },
    });

    if (!asset) {
      throw new NotFoundException('Media asset not found.');
    }

    return asset;
  }

  /**
   * Mirrors `SocialPublicationService.requirePublishableAsset` on purpose. If
   * this accepted a looser set, an operator could bind a creative to an account
   * that scheduling then refuses, and the error would arrive at the one moment
   * they can no longer act on it.
   */
  private async requirePublishableAsset(
    scope: DestinationCreativeScope,
    organicAssetId: string,
  ): Promise<SocialOrganicAssetEntity> {
    const asset = await this.organicAssetsRepository.findOne({
      where: { id: organicAssetId, ...this.organicAssetScopeWhere(scope) },
    });

    if (!asset) {
      throw new NotFoundException('Social organic asset not found.');
    }

    if (asset.status !== 'active' || !asset.isPublishEnabled) {
      throw new BadRequestException('Social organic asset is not publishable.');
    }

    return asset;
  }

  private async loadMediaAssets(
    scope: DestinationCreativeScope,
    mediaAssetIds: string[],
  ): Promise<Map<string, MediaAssetEntity>> {
    const unique = [...new Set(mediaAssetIds)];

    if (unique.length === 0) {
      return new Map();
    }

    const assets = await this.mediaAssetsRepository.find({
      where: { id: In(unique), ...this.mediaScopeWhere(scope) },
    });

    return new Map(assets.map((asset) => [asset.id, asset]));
  }

  private creativeScopeWhere(
    scope: DestinationCreativeScope,
  ): FindOptionsWhere<SocialDestinationCreativeEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private destinationScopeWhere(
    scope: DestinationCreativeScope,
  ): FindOptionsWhere<SocialContentDestinationEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private contentScopeWhere(
    scope: DestinationCreativeScope,
  ): FindOptionsWhere<SocialContentItemEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private mediaScopeWhere(
    scope: DestinationCreativeScope,
  ): FindOptionsWhere<MediaAssetEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }

  private organicAssetScopeWhere(
    scope: DestinationCreativeScope,
  ): FindOptionsWhere<SocialOrganicAssetEntity> {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
    };
  }
}
