import { Injectable } from '@nestjs/common';
import type { PublisherCapabilities } from '../provider-capabilities';
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
import { ThreadsApiClient, threadsFailure } from './threads-api.client';
import {
  THREADS_ACCOUNT_ASSET_TYPE,
  THREADS_ACCOUNT_CAPABILITIES,
  THREADS_CAROUSEL_MAX_ITEMS,
  THREADS_IMAGE_MAX_BYTES,
  THREADS_PROVIDER,
  THREADS_TEXT_MAX_LENGTH,
  threadsTextLength,
} from './threads-capabilities';

const CONTAINER_PREFIX = 'th-container:';
/** DOCUMENTED: an unpublished container expires after 24 h. */
const CONTAINER_TTL_MS = 23 * 60 * 60_000;

type Credential = PublicationExecutionInput['credential'];

/**
 * Threads container-then-publish (`POST /{user}/threads` →
 * `/threads_publish`). Media containers are created in `prepareMedia` (one
 * per item; carousel items carry no text); a text post or the carousel
 * parent is created in `publish`. A container still processing answers
 * `processing` and `reconcile` publishes it once Threads reports FINISHED.
 */
@Injectable()
export class ThreadsPublisherAdapter implements SocialPublisherAdapter {
  readonly provider = THREADS_PROVIDER;
  readonly assetTypes = [THREADS_ACCOUNT_ASSET_TYPE] as const;
  /** A lost `threads_publish` response could otherwise duplicate the post. */
  readonly retrySafety = 'non_retryable_after_send' as const;

  constructor(private readonly api: ThreadsApiClient) {}

  capabilities(assetType: string): PublisherCapabilities {
    if (assetType !== THREADS_ACCOUNT_ASSET_TYPE) {
      throw new Error(`Unsupported Threads asset type: ${assetType}`);
    }
    return THREADS_ACCOUNT_CAPABILITIES;
  }

  validate(input: PublicationPayload): ValidationResult {
    const issues: ValidationIssue[] = [];
    if (input.assetType !== THREADS_ACCOUNT_ASSET_TYPE) {
      issues.push({ field: 'assetType', reason: 'unsupported_asset_type' });
    }
    if (!THREADS_ACCOUNT_CAPABILITIES.placements.includes(input.placement)) {
      issues.push({ field: 'placement', reason: 'unsupported_placement' });
    }
    if (input.firstComment) {
      issues.push({
        field: 'firstComment',
        reason: 'unsupported_first_comment',
      });
    }
    if (input.cta) issues.push({ field: 'cta', reason: 'unsupported_cta' });
    if (input.hashtags.length > 0) {
      issues.push({ field: 'hashtags', reason: 'unsupported_hashtags' });
    }
    if (input.providerOptions !== undefined) {
      issues.push({ field: 'providerOptions', reason: 'unsupported' });
    }
    if (input.mediaAssetIds.length > THREADS_CAROUSEL_MAX_ITEMS) {
      issues.push({ field: 'mediaAssetIds', reason: 'too_many_media_assets' });
    }
    const caption = input.caption ?? '';
    if (input.mediaAssetIds.length === 0 && !caption.trim()) {
      issues.push({ field: 'caption', reason: 'text_or_media_required' });
    }
    if (threadsTextLength(caption) > THREADS_TEXT_MAX_LENGTH) {
      issues.push({ field: 'caption', reason: 'caption_too_long' });
    }
    return issues.length === 0 ? { valid: true } : { valid: false, issues };
  }

  async prepareMedia(input: MediaPreparationInput): Promise<PreparedMedia> {
    if (
      input.credential.assetType !== THREADS_ACCOUNT_ASSET_TYPE ||
      input.payload.assetType !== THREADS_ACCOUNT_ASSET_TYPE
    ) {
      throw new SocialPublisherOperationError(
        'payload_invalid',
        'threads_asset_type_mismatch',
      );
    }
    const isVideo = input.mimeType.startsWith('video/');
    if (!isVideo && input.bytes > THREADS_IMAGE_MAX_BYTES) {
      throw new SocialPublisherOperationError(
        'media_rejected',
        'threads_image_too_large',
      );
    }
    const carousel = input.mediaCount > 1;
    try {
      const id = await this.api.createContainer({
        userId: input.credential.externalAssetId,
        accessToken: input.credential.accessToken,
        mediaType: isVideo ? 'VIDEO' : 'IMAGE',
        ...(isVideo
          ? { videoUrl: input.sourceUrl }
          : { imageUrl: input.sourceUrl }),
        ...(carousel
          ? { isCarouselItem: true }
          : { text: input.payload.caption }),
      });
      return {
        providerMediaRef: `${CONTAINER_PREFIX}${id}`,
        expiresAt: new Date(Date.now() + CONTAINER_TTL_MS),
      };
    } catch (error) {
      const failure = threadsFailure(error);
      throw new SocialPublisherOperationError(failure.reason, failure.code);
    }
  }

  async publish(input: PublicationExecutionInput): Promise<PublicationResult> {
    const { credential } = input;
    if (
      credential.assetType !== THREADS_ACCOUNT_ASSET_TYPE ||
      input.payload.assetType !== THREADS_ACCOUNT_ASSET_TYPE
    ) {
      return {
        outcome: 'failed',
        reason: 'payload_invalid',
        code: 'threads_asset_type_mismatch',
      };
    }
    const ids = input.preparedMedia.map((entry) =>
      readContainerId(entry.providerMediaRef),
    );
    if (ids.some((id) => id === null)) {
      return {
        outcome: 'failed',
        reason: 'media_rejected',
        code: 'threads_prepared_media_invalid',
      };
    }
    const children = ids as string[];

    try {
      let containerId: string;
      if (children.length === 0) {
        containerId = await this.api.createContainer({
          userId: credential.externalAssetId,
          accessToken: credential.accessToken,
          mediaType: 'TEXT',
          text: input.payload.caption ?? '',
        });
      } else if (children.length > 1) {
        containerId = await this.api.createContainer({
          userId: credential.externalAssetId,
          accessToken: credential.accessToken,
          mediaType: 'CAROUSEL',
          children,
          text: input.payload.caption,
        });
      } else {
        containerId = children[0];
      }
      return await this.progressContainer(credential, containerId);
    } catch (error) {
      return { outcome: 'failed', ...threadsFailure(error) };
    }
  }

  async reconcile(input: ReconciliationInput): Promise<PublicationResult> {
    const containerId = readContainerId(input.externalPublicationId);
    if (
      input.credential.assetType !== THREADS_ACCOUNT_ASSET_TYPE ||
      !containerId
    ) {
      return {
        outcome: 'failed',
        reason: 'unknown',
        code: 'threads_reconciliation_identity_invalid',
      };
    }
    try {
      return await this.progressContainer(input.credential, containerId);
    } catch (error) {
      return { outcome: 'failed', ...threadsFailure(error) };
    }
  }

  private async progressContainer(
    credential: Credential,
    containerId: string,
  ): Promise<PublicationResult> {
    const state = await this.api.containerStatus({
      containerId,
      accessToken: credential.accessToken,
    });
    const externalPublicationId = `${CONTAINER_PREFIX}${containerId}`;
    switch (state.status) {
      case 'IN_PROGRESS':
        return {
          outcome: 'processing',
          externalPublicationId,
          providerMetadata: { phase: 'threads_container_processing' },
        };
      case 'ERROR':
        return {
          outcome: 'failed',
          reason: 'media_rejected',
          code: state.errorMessage
            ? `threads_${state.errorMessage.toLowerCase()}`.slice(0, 80)
            : 'threads_container_error',
        };
      case 'EXPIRED':
        return {
          outcome: 'failed',
          reason: 'media_rejected',
          code: 'threads_container_expired',
        };
      case 'PUBLISHED':
        // Threads confirms the public effect even when the publish response
        // was lost. Keep the container identity rather than risk a repost.
        return {
          outcome: 'published',
          externalPublicationId,
          externalPermalink: null,
          publishedAt: new Date(),
          providerMetadata: { identitySource: 'container_status' },
        };
      default:
        break;
    }

    const mediaId = await this.api.publishContainer({
      userId: credential.externalAssetId,
      accessToken: credential.accessToken,
      containerId,
    });
    // Best effort: the post is live whether or not its link answers.
    const permalink = await this.api
      .permalink({ mediaId, accessToken: credential.accessToken })
      .catch(() => null);
    return {
      outcome: 'published',
      externalPublicationId: mediaId,
      externalPermalink: permalink,
      publishedAt: new Date(),
      providerMetadata: {
        assetType: THREADS_ACCOUNT_ASSET_TYPE,
        containerId,
      },
    };
  }
}

function readContainerId(ref: string): string | null {
  if (!ref.startsWith(CONTAINER_PREFIX)) return null;
  const id = ref.slice(CONTAINER_PREFIX.length);
  return /^\d+$/.test(id) ? id : null;
}
