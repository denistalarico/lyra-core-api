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
import { SocialPublisherRegistry } from '../providers/social-publisher.registry';
import { SocialPublicationEntity } from './entities/social-publication.entity';
import {
  SocialPublicationExecutionError,
  type SocialPublicationExecutor,
} from './social-publication.worker';
import type {
  SocialPublicationExistenceCheckResult,
  SocialPublicationExternalIdentity,
} from './social-publication-run.service';

type PayloadSnapshotShape = {
  readonly placement?: unknown;
  readonly caption?: unknown;
  readonly cta?: unknown;
  readonly hashtags?: unknown;
  readonly firstComment?: unknown;
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
  ) {}

  async publish(
    publication: SocialPublicationEntity,
  ): Promise<SocialPublicationExternalIdentity> {
    const adapter = this.registry.resolve(publication.provider);
    const asset = await this.requireAsset(publication);
    const payload = this.buildPayload(publication, asset.assetType);

    const providerValidation = adapter.validate(payload);
    if (!providerValidation.valid) {
      throw new SocialPublicationExecutionError(
        'payload_invalid',
        'provider_payload_rejected',
      );
    }

    const credential = await this.credentialResolver.resolve({
      assetId: publication.assetId,
      tenantId: publication.tenantId,
      workspaceId: publication.workspaceId,
      agencyClientId: publication.agencyClientId,
    });

    const preparedMedia =
      payload.mediaAssetId === null
        ? null
        : await this.prepareMedia({
            mediaAssetId: payload.mediaAssetId,
            publication,
            payload,
            credential,
            adapter,
          });

    const executionInput: PublicationExecutionInput = {
      credential,
      payload,
      preparedMedia,
      idempotencyKey: publication.idempotencyKey,
    };

    const result = await adapter.publish(executionInput);

    if (result.outcome === 'failed') {
      throw new SocialPublicationExecutionError(result.reason, result.code);
    }

    if (result.outcome === 'processing') {
      // Async providers confirm via reconcile(); the worker only records
      // terminal identities, so treat "accepted" as not-yet-publishable here.
      throw new SocialPublicationExecutionError(
        'provider_unavailable',
        'publication_processing_requires_reconciliation',
      );
    }

    return {
      publishedAt: result.publishedAt,
      externalPublicationId: result.externalPublicationId,
      externalPermalink: result.externalPermalink,
      providerMetadata: result.providerMetadata,
    };
  }

  async checkExisting(
    publication: SocialPublicationEntity,
  ): Promise<SocialPublicationExistenceCheckResult> {
    if (!this.registry.has(publication.provider)) {
      return { outcome: 'unsafe_to_retry' };
    }

    const adapter = this.registry.resolve(publication.provider);
    if (!adapter.reconcile || !publication.externalPublicationId) {
      return { outcome: 'unsafe_to_retry' };
    }

    try {
      const credential = await this.credentialResolver.resolve({
        assetId: publication.assetId,
        tenantId: publication.tenantId,
        workspaceId: publication.workspaceId,
        agencyClientId: publication.agencyClientId,
      });

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

      return { outcome: 'absent' };
    } catch {
      return { outcome: 'unsafe_to_retry' };
    }
  }

  private async prepareMedia(input: {
    mediaAssetId: string;
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

    return adapter.prepareMedia({
      credential,
      payload,
      ...prepared,
    });
  }

  private buildPayload(
    publication: SocialPublicationEntity,
    assetType: string,
  ): PublicationPayload {
    const snapshot = publication.payloadSnapshot as PayloadSnapshotShape;

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
