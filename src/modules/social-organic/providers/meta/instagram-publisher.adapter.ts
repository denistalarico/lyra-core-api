import { Injectable } from '@nestjs/common';
import type {
  MediaPreparationInput,
  PreparedMedia,
  PublicationExecutionInput,
  PublicationPayload,
  PublicationResult,
  ReconciliationInput,
  SocialPublisherAdapter,
  ValidationIssue,
  ValidationResult,
} from '../social-publisher.adapter';
import { SocialPublisherOperationError } from '../social-publisher.adapter';
import type { PublisherCapabilities } from '../provider-capabilities';
import { META_INSTAGRAM_PROFESSIONAL_CAPABILITIES } from './meta-capabilities';
import { MetaOrganicGraphService } from './meta-organic-graph.service';
import {
  decodeMetaPreparedMediaRef,
  encodeMetaPreparedMediaRef,
  metaPublicationFailure,
} from './meta-publisher.support';

const INSTAGRAM_ASSET_TYPE = 'instagram_professional';
const INSTAGRAM_CONTAINER_PREFIX = 'ig-container:';
const INSTAGRAM_CONTAINER_TTL_MS = 23 * 60 * 60_000;

/** Instagram Professional container-then-publish adapter. */
@Injectable()
export class InstagramPublisherAdapter implements SocialPublisherAdapter {
  readonly provider: string = 'meta';
  readonly assetTypes = [INSTAGRAM_ASSET_TYPE] as const;
  readonly retrySafety = 'non_retryable_after_send' as const;

  constructor(protected readonly graph: MetaOrganicGraphService) {}

  protected get instagramRequestOptions():
    | { apiHost: 'instagram' }
    | Record<string, never> {
    return this.provider === 'instagram' ? { apiHost: 'instagram' } : {};
  }

  capabilities(assetType: string): PublisherCapabilities {
    if (assetType !== INSTAGRAM_ASSET_TYPE) {
      throw new Error(
        `Unsupported Instagram publisher asset type: ${assetType}`,
      );
    }
    return META_INSTAGRAM_PROFESSIONAL_CAPABILITIES;
  }

  validate(input: PublicationPayload): ValidationResult {
    const issues: ValidationIssue[] = [];
    if (input.assetType !== INSTAGRAM_ASSET_TYPE) {
      issues.push({ field: 'assetType', reason: 'unsupported_asset_type' });
    }
    if (!META_INSTAGRAM_PROFESSIONAL_CAPABILITIES.placements.includes(input.placement)) {
      issues.push({ field: 'placement', reason: 'unsupported_placement' });
    }
    if (!input.mediaAssetIds.length) {
      issues.push({ field: 'mediaAssetId', reason: 'media_required' });
    }
    if (input.firstComment) {
      issues.push({
        field: 'firstComment',
        reason: 'unsupported_first_comment',
      });
    }
    if (input.cta) {
      issues.push({ field: 'cta', reason: 'unsupported_cta' });
    }
    if (input.hashtags.length > 0) {
      issues.push({ field: 'hashtags', reason: 'unsupported_hashtags' });
    }
    if (input.placement === 'story' && input.caption) {
      issues.push({ field: 'caption', reason: 'unsupported_story_caption' });
    }
    if (input.mediaAssetIds.length > 10) {
      issues.push({ field: 'mediaAssetIds', reason: 'too_many_media_assets' });
    }
    if (input.mediaAssetIds.length > 1 && input.placement !== 'feed') {
      issues.push({ field: 'mediaAssetIds', reason: 'carousel_feed_only' });
    }

    return issues.length === 0 ? { valid: true } : { valid: false, issues };
  }

  async prepareMedia(input: MediaPreparationInput): Promise<PreparedMedia> {
    try {
      if (
        input.credential.assetType !== INSTAGRAM_ASSET_TYPE ||
        input.payload.assetType !== INSTAGRAM_ASSET_TYPE
      ) {
        throw new SocialPublisherOperationError(
          'payload_invalid',
          'instagram_asset_type_mismatch',
        );
      }
      if (
        input.payload.placement !== 'feed' &&
        input.payload.placement !== 'reel' &&
        input.payload.placement !== 'story'
      ) {
        throw new SocialPublisherOperationError(
          'payload_invalid',
          'instagram_placement_unsupported',
        );
      }

      const container = await this.graph.createInstagramContainer({
        accountId: input.credential.externalAssetId,
        pageAccessToken: input.credential.accessToken,
        sourceUrl: input.sourceUrl,
        mediaKind: input.mimeType.startsWith('video/') ? 'video' : 'image',
        placement: input.payload.placement,
        caption:
          input.mediaCount > 1 || input.payload.placement === 'story' ? null : input.payload.caption,
        carouselItem: input.mediaCount > 1,
        ...this.instagramRequestOptions,
      });

      return {
        providerMediaRef: encodeMetaPreparedMediaRef({
          kind: 'instagram_container',
          id: container.id,
        }),
        expiresAt: new Date(Date.now() + INSTAGRAM_CONTAINER_TTL_MS),
      };
    } catch (error) {
      if (error instanceof SocialPublisherOperationError) throw error;
      const failure = metaPublicationFailure(error);
      throw new SocialPublisherOperationError(failure.reason, failure.code);
    }
  }

  async publish(input: PublicationExecutionInput): Promise<PublicationResult> {
    if (
      input.credential.assetType !== INSTAGRAM_ASSET_TYPE ||
      input.payload.assetType !== INSTAGRAM_ASSET_TYPE
    ) {
      return {
        outcome: 'failed',
        reason: 'payload_invalid',
        code: 'instagram_asset_type_mismatch',
      };
    }

    const decodedMedia = input.preparedMedia.map((entry) => decodeMetaPreparedMediaRef(entry.providerMediaRef));
    if (!decodedMedia.length || decodedMedia.some((entry) => entry?.kind !== 'instagram_container')) {
      return {
        outcome: 'failed',
        reason: 'media_rejected',
        code: 'instagram_prepared_media_invalid',
      };
    }
    const media = decodedMedia.filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (media.length > 1) {
      try {
        const parent = await this.graph.createInstagramCarouselContainer({
          accountId: input.credential.externalAssetId,
          pageAccessToken: input.credential.accessToken,
          childContainerIds: media.map((entry) => entry.id),
          caption: input.payload.caption,
          ...this.instagramRequestOptions,
        });
        return this.progressContainer(input.credential, parent.id);
      } catch (error) {
        return metaPublicationFailure(error);
      }
    }
    return this.progressContainer(input.credential, media[0]!.id);
  }

  async reconcile(input: ReconciliationInput): Promise<PublicationResult> {
    if (input.credential.assetType !== INSTAGRAM_ASSET_TYPE) {
      return {
        outcome: 'failed',
        reason: 'payload_invalid',
        code: 'instagram_asset_type_mismatch',
      };
    }
    if (!input.externalPublicationId.startsWith(INSTAGRAM_CONTAINER_PREFIX)) {
      return {
        outcome: 'failed',
        reason: 'unknown',
        code: 'instagram_reconciliation_identity_invalid',
      };
    }

    const containerId = input.externalPublicationId.slice(
      INSTAGRAM_CONTAINER_PREFIX.length,
    );
    if (!containerId) {
      return {
        outcome: 'failed',
        reason: 'unknown',
        code: 'instagram_reconciliation_identity_invalid',
      };
    }
    return this.progressContainer(input.credential, containerId);
  }

  private async progressContainer(
    credential: PublicationExecutionInput['credential'],
    containerId: string,
  ): Promise<PublicationResult> {
    try {
      const status = await this.graph.getInstagramContainerStatus({
        containerId,
        pageAccessToken: credential.accessToken,
        ...this.instagramRequestOptions,
      });

      if (status === 'IN_PROGRESS') {
        return {
          outcome: 'processing',
          externalPublicationId: `${INSTAGRAM_CONTAINER_PREFIX}${containerId}`,
          providerMetadata: { phase: 'container_processing' },
        };
      }
      if (status === 'EXPIRED' || status === 'ERROR') {
        return {
          outcome: 'failed',
          reason: 'media_rejected',
          code:
            status === 'EXPIRED'
              ? 'instagram_container_expired'
              : 'instagram_container_error',
        };
      }
      if (status === 'PUBLISHED') {
        // Meta confirms the public effect even when the media_publish response
        // was lost. Keep the container identity rather than risking a repost.
        return {
          outcome: 'published',
          externalPublicationId: `${INSTAGRAM_CONTAINER_PREFIX}${containerId}`,
          externalPermalink: null,
          publishedAt: new Date(),
          providerMetadata: { identitySource: 'container_status' },
        };
      }

      const published = await this.graph.publishInstagramContainer({
        accountId: credential.externalAssetId,
        pageAccessToken: credential.accessToken,
        containerId,
        ...this.instagramRequestOptions,
      });
      return {
        outcome: 'published',
        externalPublicationId: published.id,
        externalPermalink: null,
        publishedAt: new Date(),
        providerMetadata: { assetType: INSTAGRAM_ASSET_TYPE },
      };
    } catch (error) {
      return metaPublicationFailure(error);
    }
  }
}

/**
 * Instagram Login issues a token for graph.instagram.com and is intentionally
 * registered under a distinct provider key. The publication semantics are the
 * same container workflow, but it must never be resolved as a Facebook Login
 * asset by accident.
 */
@Injectable()
export class DirectInstagramPublisherAdapter extends InstagramPublisherAdapter {
  override readonly provider = 'instagram';
}
