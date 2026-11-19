import { Injectable, Logger } from '@nestjs/common';
import { coverFailureCode, readCoverImage } from '../cover-image';
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
import {
  LINKEDIN_ORGANIZATION_ASSET_TYPE,
  LINKEDIN_ORGANIZATION_CAPABILITIES,
  LINKEDIN_PROVIDER,
  LINKEDIN_VIDEO_MIN_BYTES,
} from './linkedin-capabilities';
import { toLinkedInLittleText } from './linkedin-commentary';
import {
  LinkedInOrganicApiClient,
  LinkedInOrganicApiError,
  linkedInFailure,
  organizationUrn,
} from './linkedin-organic-api.client';

const IMAGE_PREFIX = 'li-image:';
const VIDEO_PREFIX = 'li-video:';
const PREPARED_MEDIA_TTL_MS = 23 * 60 * 60_000;
const IMAGE_STATUS_ATTEMPTS = 3;
const IMAGE_STATUS_DELAY_MS = 2_000;

export function linkedInPermalink(postUrn: string): string {
  return `https://www.linkedin.com/feed/update/${postUrn}/`;
}

/**
 * LinkedIn Page posts (Posts API). Text or one image on `feed`, one MP4 on
 * `video`. Media are uploaded in `prepareMedia`; the post itself is created in
 * `publish`. A video post may stay `PUBLISH_REQUESTED` while LinkedIn
 * processes it, so `reconcile` reads `lifecycleState`.
 */
@Injectable()
export class LinkedInPublisherAdapter implements SocialPublisherAdapter {
  readonly provider = LINKEDIN_PROVIDER;
  readonly assetTypes = [LINKEDIN_ORGANIZATION_ASSET_TYPE] as const;
  /** A lost 201 cannot be told apart from a failure: never resend a post. */
  readonly retrySafety = 'non_retryable_after_send' as const;
  private readonly logger = new Logger(LinkedInPublisherAdapter.name);

  /** Overridable in specs; not a provider dependency. */
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  constructor(private readonly api: LinkedInOrganicApiClient) {}

  capabilities(assetType: string): PublisherCapabilities {
    if (assetType !== LINKEDIN_ORGANIZATION_ASSET_TYPE) {
      throw new Error(
        `Unsupported LinkedIn publisher asset type: ${assetType}`,
      );
    }
    return LINKEDIN_ORGANIZATION_CAPABILITIES;
  }

  validate(input: PublicationPayload): ValidationResult {
    const issues: ValidationIssue[] = [];
    if (input.assetType !== LINKEDIN_ORGANIZATION_ASSET_TYPE) {
      issues.push({ field: 'assetType', reason: 'unsupported_asset_type' });
    }
    if (
      !LINKEDIN_ORGANIZATION_CAPABILITIES.placements.includes(input.placement)
    ) {
      issues.push({ field: 'placement', reason: 'unsupported_placement' });
    }
    if (input.firstComment) {
      issues.push({
        field: 'firstComment',
        reason: 'unsupported_first_comment',
      });
    }
    if (input.cta) issues.push({ field: 'cta', reason: 'unsupported_cta' });
    if (input.mediaAssetIds.length > 1) {
      issues.push({ field: 'mediaAssetIds', reason: 'single_media_only' });
    }
    if (input.placement === 'video' && input.mediaAssetIds.length !== 1) {
      issues.push({ field: 'mediaAssetIds', reason: 'single_video_required' });
    }
    if (input.mediaAssetIds.length === 0 && !input.caption?.trim()) {
      issues.push({ field: 'caption', reason: 'caption_required' });
    }
    return issues.length === 0 ? { valid: true } : { valid: false, issues };
  }

  async prepareMedia(input: MediaPreparationInput): Promise<PreparedMedia> {
    if (
      input.credential.assetType !== LINKEDIN_ORGANIZATION_ASSET_TYPE ||
      input.payload.assetType !== LINKEDIN_ORGANIZATION_ASSET_TYPE
    ) {
      throw new SocialPublisherOperationError(
        'payload_invalid',
        'linkedin_asset_type_mismatch',
      );
    }
    const isVideo = input.payload.placement === 'video';
    if (
      input.bytes <= 0 ||
      (isVideo
        ? !input.mimeType.startsWith('video/') ||
          input.bytes < LINKEDIN_VIDEO_MIN_BYTES
        : !input.mimeType.startsWith('image/'))
    ) {
      throw new SocialPublisherOperationError(
        'media_rejected',
        isVideo ? 'linkedin_video_required' : 'linkedin_image_required',
      );
    }

    const accessToken = input.credential.accessToken;
    const owner = organizationUrn(input.credential.externalAssetId);
    try {
      if (isVideo) {
        const coverImage = input.payload.cover?.image ?? null;
        const session = await this.api.initializeVideoUpload(accessToken, {
          ownerUrn: owner,
          fileSizeBytes: input.bytes,
          withThumbnail: coverImage !== null,
        });
        const etags = await this.api.uploadVideoParts({
          instructions: session.instructions,
          sourceUrl: input.sourceUrl,
          totalBytes: input.bytes,
        });
        if (coverImage && session.thumbnailUploadUrl) {
          // A feed video serves even when its thumbnail fails (DOCUMENTED).
          try {
            await this.api.uploadVideoThumbnail({
              uploadUrl: session.thumbnailUploadUrl,
              data: await readCoverImage(coverImage),
            });
          } catch (error) {
            this.logger.warn(
              `linkedin video: cover not applied (${coverFailureCode(error)})`,
            );
          }
        }
        await this.api.finalizeVideoUpload(accessToken, {
          video: session.video,
          uploadToken: session.uploadToken,
          etags,
        });
        return this.prepared(`${VIDEO_PREFIX}${session.video}`);
      }

      const session = await this.api.initializeImageUpload(accessToken, owner);
      await this.api.uploadImage({
        accessToken,
        uploadUrl: session.uploadUrl,
        sourceUrl: input.sourceUrl,
        totalBytes: input.bytes,
        mimeType: input.mimeType,
      });
      // A post created before the image is AVAILABLE may never render.
      await this.waitForImage(accessToken, session.image);
      return this.prepared(`${IMAGE_PREFIX}${session.image}`);
    } catch (error) {
      if (error instanceof SocialPublisherOperationError) throw error;
      const failure = linkedInFailure(error);
      throw new SocialPublisherOperationError(failure.reason, failure.code);
    }
  }

  async publish(input: PublicationExecutionInput): Promise<PublicationResult> {
    if (input.credential.assetType !== LINKEDIN_ORGANIZATION_ASSET_TYPE) {
      return {
        outcome: 'failed',
        reason: 'payload_invalid',
        code: 'linkedin_asset_type_mismatch',
      };
    }
    const ref = input.preparedMedia[0]?.providerMediaRef ?? null;
    const media = ref ? this.mediaUrn(ref) : null;
    if (ref && !media) {
      return {
        outcome: 'failed',
        reason: 'media_rejected',
        code: 'linkedin_prepared_media_invalid',
      };
    }
    if (
      input.payload.placement === 'video' &&
      !media?.startsWith('urn:li:video:')
    ) {
      return {
        outcome: 'failed',
        reason: 'media_rejected',
        code: 'linkedin_prepared_media_invalid',
      };
    }

    try {
      const postUrn = await this.api.createPost(input.credential.accessToken, {
        author: organizationUrn(input.credential.externalAssetId),
        commentary: toLinkedInLittleText(input.payload.caption),
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        ...(media ? { content: { media: { id: media } } } : {}),
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      });
      if (media?.startsWith('urn:li:video:')) {
        return {
          outcome: 'processing',
          externalPublicationId: postUrn,
          providerMetadata: { phase: 'linkedin_video_processing' },
        };
      }
      return {
        outcome: 'published',
        externalPublicationId: postUrn,
        externalPermalink: linkedInPermalink(postUrn),
        publishedAt: new Date(),
        providerMetadata: { assetType: LINKEDIN_ORGANIZATION_ASSET_TYPE },
      };
    } catch (error) {
      return { outcome: 'failed', ...linkedInFailure(error) };
    }
  }

  async reconcile(input: ReconciliationInput): Promise<PublicationResult> {
    const postUrn = input.externalPublicationId;
    if (
      input.credential.assetType !== LINKEDIN_ORGANIZATION_ASSET_TYPE ||
      !/^urn:li:(share|ugcPost):\S+$/.test(postUrn)
    ) {
      return {
        outcome: 'failed',
        reason: 'unknown',
        code: 'linkedin_reconciliation_identity_invalid',
      };
    }
    try {
      const state = await this.api.postLifecycle(
        input.credential.accessToken,
        postUrn,
      );
      if (state === 'PUBLISHED') {
        return {
          outcome: 'published',
          externalPublicationId: postUrn,
          externalPermalink: linkedInPermalink(postUrn),
          publishedAt: new Date(),
          providerMetadata: { assetType: LINKEDIN_ORGANIZATION_ASSET_TYPE },
        };
      }
      if (state === 'PUBLISH_FAILED') {
        return {
          outcome: 'failed',
          reason: 'media_rejected',
          code: 'linkedin_publish_failed',
        };
      }
      return {
        outcome: 'processing',
        externalPublicationId: postUrn,
        providerMetadata: { phase: 'linkedin_video_processing' },
      };
    } catch (error) {
      if (error instanceof LinkedInOrganicApiError && error.status === 404) {
        return {
          outcome: 'failed',
          reason: 'unknown',
          code: 'linkedin_post_missing',
        };
      }
      return { outcome: 'failed', ...linkedInFailure(error) };
    }
  }

  private prepared(providerMediaRef: string): PreparedMedia {
    return {
      providerMediaRef,
      expiresAt: new Date(Date.now() + PREPARED_MEDIA_TTL_MS),
    };
  }

  private mediaUrn(ref: string): string | null {
    if (ref.startsWith(IMAGE_PREFIX)) {
      const urn = ref.slice(IMAGE_PREFIX.length);
      return urn.startsWith('urn:li:image:') ? urn : null;
    }
    if (ref.startsWith(VIDEO_PREFIX)) {
      const urn = ref.slice(VIDEO_PREFIX.length);
      return urn.startsWith('urn:li:video:') ? urn : null;
    }
    return null;
  }

  private async waitForImage(
    accessToken: string,
    imageUrn: string,
  ): Promise<void> {
    for (let attempt = 1; attempt <= IMAGE_STATUS_ATTEMPTS; attempt += 1) {
      const status = await this.api.imageStatus(accessToken, imageUrn);
      if (status === 'AVAILABLE') return;
      if (status === 'PROCESSING_FAILED') {
        throw new SocialPublisherOperationError(
          'media_rejected',
          'linkedin_image_processing_failed',
        );
      }
      if (attempt < IMAGE_STATUS_ATTEMPTS)
        await this.sleep(IMAGE_STATUS_DELAY_MS);
    }
    throw new SocialPublisherOperationError(
      'provider_unavailable',
      'linkedin_image_processing',
    );
  }
}
