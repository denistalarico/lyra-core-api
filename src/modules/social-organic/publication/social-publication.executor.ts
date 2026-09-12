import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MediaAssetResolverService } from '../../../common/media-assets';
import { SocialOrganicCredentialResolver } from '../credentials/social-organic-credential.resolver';
import { SocialOrganicAssetEntity } from '../entities/social-organic-asset.entity';
import { checkMediaAssetCapability } from '../media/media-capability-check';
import { MediaPreparationService } from '../media/media-preparation.service';
import type {
  PublicationExecutionInput,
  PublicationPayload,
} from '../providers/social-publisher.adapter';
import { SocialPublisherOperationError } from '../providers/social-publisher.adapter';
import { SocialPublisherRegistry } from '../providers/social-publisher.registry';
import { SocialPublicationEntity } from './entities/social-publication.entity';
import { SocialPublicationConfigService } from './social-publication-config.service';
import {
  SocialPublicationExecutionError,
  type SocialPublicationExecutor,
} from './social-publication.worker';
import type {
  SocialPublicationExistenceCheckResult,
  SocialPublicationExternalIdentity,
  SocialPublicationProcessingIdentity,
} from './social-publication-run.service';

type PayloadSnapshotShape = {
  readonly placement?: unknown;
  readonly caption?: unknown;
  readonly cta?: unknown;
  readonly hashtags?: unknown;
  readonly firstComment?: unknown;
  readonly mediaAssetIds?: unknown;
};

/**
 * The real `SocialPublicationExecutor`: turns a claimed row into a call
 * against the registered `SocialPublisherAdapter`, resolving and validating
 * media along the way (M3.1B).
 *
 * Execution order before any external effect (blueprint requirement):
 *   1. adapter.validate(payload)           — provider-specific payload rules
 *   2. media resolve (scoped)              — mediaAssetId -> MediaAsset
 *   3. M1 media capability validation      — metadata vs. declared capability
 *   4. M3 prepare source                   — storage object -> signed fetch
 *   5. adapter.prepareMedia
 *   6. adapter.publish
 *
 * `mediaAssetId == null` short-circuits steps 2-5: `preparedMedia` stays
 * `null` and a text-only publication executes exactly as before this task.
 *
 * Step 3's resolve+capability check is shared with `SocialPublicationService`
 * (`P3.1` schedule-time validation) via `checkMediaAssetCapability` — this
 * remains defense in depth, since capabilities/assets can change between
 * schedule time and execution time.
 */
@Injectable()
export class SocialPublicationExecutorService implements SocialPublicationExecutor {
  constructor(
    @InjectRepository(SocialOrganicAssetEntity, 'agency')
    private readonly assetsRepository: Repository<SocialOrganicAssetEntity>,
    private readonly registry: SocialPublisherRegistry,
    private readonly credentialResolver: SocialOrganicCredentialResolver,
    private readonly mediaAssetResolver: MediaAssetResolverService,
    private readonly mediaPreparationService: MediaPreparationService,
    private readonly config: SocialPublicationConfigService,
  ) {}

  async publish(
    publication: SocialPublicationEntity,
  ): Promise<
    SocialPublicationExternalIdentity | SocialPublicationProcessingIdentity
  > {
    const asset = await this.requireAsset(publication);
    const adapter = this.registry.resolve(
      publication.provider,
      asset.assetType,
    );

    if (!this.config.isProviderEnabled(publication.provider)) {
      throw new SocialPublicationExecutionError(
        'provider_unavailable',
        'provider_publication_disabled',
      );
    }

    if (publication.externalPublicationId) {
      if (!adapter.reconcile) {
        throw new SocialPublicationExecutionError(
          'unknown',
          'publication_reconciliation_unavailable',
        );
      }
      const credential = await this.resolveCredential(publication);
      return this.normalizeResult(
        await adapter.reconcile({
          credential,
          externalPublicationId: publication.externalPublicationId,
        }),
      );
    }

    const payload = this.buildPayload(publication, asset.assetType);

    const providerValidation = adapter.validate(payload);
    if (!providerValidation.valid) {
      throw new SocialPublicationExecutionError(
        'payload_invalid',
        'provider_payload_rejected',
      );
    }

    const credential = await this.resolveCredential(publication);

    const preparedMedia = await Promise.all(
      payload.mediaAssetIds.map((mediaAssetId, mediaIndex) =>
        this.prepareMedia({
          mediaAssetId,
          mediaIndex,
          mediaCount: payload.mediaAssetIds.length,
          publication,
          payload,
          credential,
          adapter,
        }),
      ),
    );

    const executionInput: PublicationExecutionInput = {
      credential,
      payload,
      preparedMedia,
      idempotencyKey: publication.idempotencyKey,
    };

    return this.normalizeResult(await adapter.publish(executionInput));
  }

  async checkExisting(
    publication: SocialPublicationEntity,
  ): Promise<SocialPublicationExistenceCheckResult> {
    if (!this.config.isProviderEnabled(publication.provider)) {
      return { outcome: 'unsafe_to_retry' };
    }
    const asset = await this.requireAsset(publication).catch(() => null);
    if (!asset || !this.registry.has(publication.provider, asset.assetType)) {
      return { outcome: 'unsafe_to_retry' };
    }

    const adapter = this.registry.resolve(
      publication.provider,
      asset.assetType,
    );
    if (!adapter.reconcile || !publication.externalPublicationId) {
      return { outcome: 'unsafe_to_retry' };
    }

    try {
      const credential = await this.resolveCredential(publication);

      const result = await adapter.reconcile({
        credential,
        externalPublicationId: publication.externalPublicationId,
      });

      if (result.outcome === 'published') {
        return {
          outcome: 'published',
          publishedAt: result.publishedAt,
          externalPublicationId: result.externalPublicationId,
          externalPermalink: result.externalPermalink,
          providerMetadata: result.providerMetadata,
        };
      }

      if (result.outcome === 'processing') {
        return { outcome: 'unsafe_to_retry' };
      }

      return result.reason === 'media_rejected' ||
        result.reason === 'payload_invalid'
        ? { outcome: 'absent' }
        : { outcome: 'unsafe_to_retry' };
    } catch {
      return { outcome: 'unsafe_to_retry' };
    }
  }

  private normalizeResult(
    result: Awaited<
      ReturnType<ReturnType<SocialPublisherRegistry['resolve']>['publish']>
    >,
  ): SocialPublicationExternalIdentity | SocialPublicationProcessingIdentity {
    if (result.outcome === 'failed') {
      throw new SocialPublicationExecutionError(result.reason, result.code);
    }
    if (result.outcome === 'processing') return result;

    return {
      publishedAt: result.publishedAt,
      externalPublicationId: result.externalPublicationId,
      externalPermalink: result.externalPermalink,
      providerMetadata: result.providerMetadata,
    };
  }

  private resolveCredential(publication: SocialPublicationEntity) {
    return this.credentialResolver.resolve({
      assetId: publication.assetId,
      tenantId: publication.tenantId,
      workspaceId: publication.workspaceId,
      agencyClientId: publication.agencyClientId,
    });
  }

  private async prepareMedia(input: {
    mediaAssetId: string;
    mediaIndex: number;
    mediaCount: number;
    publication: SocialPublicationEntity;
    payload: PublicationPayload;
    credential: Awaited<ReturnType<SocialOrganicCredentialResolver['resolve']>>;
    adapter: ReturnType<SocialPublisherRegistry['resolve']>;
  }) {
    const { publication, payload, credential, adapter } = input;

    const resolvedMedia = await this.mediaAssetResolver.resolve({
      mediaAssetId: input.mediaAssetId,
      tenantId: publication.tenantId,
      workspaceId: publication.workspaceId,
      agencyClientId: publication.agencyClientId,
    });

    const capabilities = adapter.capabilities(payload.assetType);
    const capabilityCheck = checkMediaAssetCapability(
      resolvedMedia,
      capabilities,
      payload.placement,
    );

    if (!capabilityCheck.valid) {
      throw new SocialPublicationExecutionError(
        'media_rejected',
        'media_capability_mismatch',
      );
    }

    const byteSize = Number(resolvedMedia.byteSize);
    const prepared = await this.mediaPreparationService.prepare({
      media: {
        storagePath: resolvedMedia.storagePath,
        mimeType: resolvedMedia.mimeType,
        bytes: Number.isFinite(byteSize) ? byteSize : 0,
      },
      provider: publication.provider,
      placement: payload.placement,
    });

    try {
      return await adapter.prepareMedia({
        credential,
        payload,
        mediaIndex: input.mediaIndex,
        mediaCount: input.mediaCount,
        ...prepared,
      });
    } catch (error) {
      if (error instanceof SocialPublisherOperationError) {
        throw new SocialPublicationExecutionError(error.reason, error.code);
      }
      throw error;
    }
  }

  private buildPayload(
    publication: SocialPublicationEntity,
    assetType: string,
  ): PublicationPayload {
    const snapshot = publication.payloadSnapshot as PayloadSnapshotShape;

    const snapshotMediaIds = Array.isArray(snapshot.mediaAssetIds)
      ? snapshot.mediaAssetIds.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const mediaAssetIds = snapshotMediaIds.length
      ? snapshotMediaIds
      : publication.mediaAssetId
        ? [publication.mediaAssetId]
        : [];
    return {
      assetType,
      placement:
        typeof snapshot.placement === 'string' ? snapshot.placement : '',
      caption: typeof snapshot.caption === 'string' ? snapshot.caption : null,
      firstComment:
        typeof snapshot.firstComment === 'string'
          ? snapshot.firstComment
          : null,
      hashtags: Array.isArray(snapshot.hashtags)
        ? snapshot.hashtags.filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : [],
      cta: typeof snapshot.cta === 'string' ? snapshot.cta : null,
      mediaAssetId: publication.mediaAssetId,
      mediaAssetIds,
      scheduledAt: publication.scheduledAt,
    };
  }

  private async requireAsset(
    publication: SocialPublicationEntity,
  ): Promise<SocialOrganicAssetEntity> {
    const asset = await this.assetsRepository.findOne({
      where: { id: publication.assetId },
    });

    if (!asset) {
      throw new NotFoundException('Social organic asset not found.');
    }

    return asset;
  }
}
