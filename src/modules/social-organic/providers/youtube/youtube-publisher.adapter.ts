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
import { YoutubeApiClient, youtubeFailure } from './youtube-api.client';
import {
  YOUTUBE_CHANNEL_ASSET_TYPE,
  YOUTUBE_CHANNEL_CAPABILITIES,
  YOUTUBE_PROVIDER,
} from './youtube-capabilities';
import {
  YOUTUBE_DESCRIPTION_MAX_BYTES,
  buildYoutubeMetadata,
  youtubeOptions,
} from './youtube-metadata';
import { YoutubeUploadQuota } from './youtube-upload-quota';

const VIDEO_PREFIX = 'yt-video:';
const PREPARED_MEDIA_TTL_MS = 23 * 60 * 60_000;

/**
 * YouTube channel publishing (D-I6). The upload happens in `prepareMedia`,
 * which the executor calls at the item's scheduled time, so the public video
 * appears then. `publish` only reports `processing`; `reconcile` reads
 * `status.uploadStatus`.
 */
@Injectable()
export class YoutubePublisherAdapter implements SocialPublisherAdapter {
  readonly provider = YOUTUBE_PROVIDER;
  readonly assetTypes = [YOUTUBE_CHANNEL_ASSET_TYPE] as const;
  /** A lost response after the last chunk could otherwise duplicate the video. */
  readonly retrySafety = 'non_retryable_after_send' as const;
  private readonly logger = new Logger(YoutubePublisherAdapter.name);

  constructor(
    private readonly api: YoutubeApiClient,
    private readonly quota: YoutubeUploadQuota,
  ) {}

  capabilities(assetType: string): PublisherCapabilities {
    if (assetType !== YOUTUBE_CHANNEL_ASSET_TYPE) {
      throw new Error(`Unsupported YouTube publisher asset type: ${assetType}`);
    }
    return YOUTUBE_CHANNEL_CAPABILITIES;
  }

  validate(input: PublicationPayload): ValidationResult {
    const issues: ValidationIssue[] = [];
    if (input.assetType !== YOUTUBE_CHANNEL_ASSET_TYPE) {
      issues.push({ field: 'assetType', reason: 'unsupported_asset_type' });
    }
    if (!YOUTUBE_CHANNEL_CAPABILITIES.placements.includes(input.placement)) {
      issues.push({ field: 'placement', reason: 'unsupported_placement' });
    }
    if (input.firstComment) {
      issues.push({
        field: 'firstComment',
        reason: 'unsupported_first_comment',
      });
    }
    if (input.cta) issues.push({ field: 'cta', reason: 'unsupported_cta' });
    if (input.mediaAssetIds.length !== 1) {
      issues.push({ field: 'mediaAssetIds', reason: 'single_video_required' });
    }
    if (!youtubeOptions(input).title) {
      issues.push({ field: 'caption', reason: 'title_required' });
    }
    if (
      Buffer.byteLength(input.caption ?? '', 'utf8') >
      YOUTUBE_DESCRIPTION_MAX_BYTES
    ) {
      issues.push({ field: 'caption', reason: 'description_too_long' });
    }
    return issues.length === 0 ? { valid: true } : { valid: false, issues };
  }

  async prepareMedia(input: MediaPreparationInput): Promise<PreparedMedia> {
    if (
      input.credential.assetType !== YOUTUBE_CHANNEL_ASSET_TYPE ||
      input.payload.assetType !== YOUTUBE_CHANNEL_ASSET_TYPE
    ) {
      throw new SocialPublisherOperationError(
        'payload_invalid',
        'youtube_asset_type_mismatch',
      );
    }
    if (!input.mimeType.startsWith('video/') || input.bytes <= 0) {
      throw new SocialPublisherOperationError(
        'media_rejected',
        'youtube_video_required',
      );
    }
    if (!this.quota.tryConsume()) {
      throw new SocialPublisherOperationError(
        'rate_limited',
        'quota_budget_exhausted',
      );
    }

    try {
      const sessionUrl = await this.api.startUpload({
        accessToken: input.credential.accessToken,
        metadata: buildYoutubeMetadata(input.payload),
        totalBytes: input.bytes,
        mimeType: input.mimeType,
      });
      const videoId = await this.api.uploadFromSource({
        sessionUrl,
        sourceUrl: input.sourceUrl,
        totalBytes: input.bytes,
        mimeType: input.mimeType,
      });
      await this.applyCover(input, videoId);
      return {
        providerMediaRef: `${VIDEO_PREFIX}${videoId}`,
        expiresAt: new Date(Date.now() + PREPARED_MEDIA_TTL_MS),
      };
    } catch (error) {
      const failure = youtubeFailure(error);
      throw new SocialPublisherOperationError(failure.reason, failure.code);
    }
  }

  /** Best effort: the video is already uploaded and must not fail on this. */
  private async applyCover(
    input: MediaPreparationInput,
    videoId: string,
  ): Promise<void> {
    const image = input.payload.cover?.image;
    if (!image) return;
    try {
      await this.api.setThumbnail({
        accessToken: input.credential.accessToken,
        videoId,
        data: await readCoverImage(image),
        mimeType: image.mimeType,
      });
    } catch (error) {
      this.logger.warn(
        `youtube video ${videoId}: cover not applied (${coverFailureCode(error)})`,
      );
    }
  }

  publish(input: PublicationExecutionInput): Promise<PublicationResult> {
    const ref = input.preparedMedia[0]?.providerMediaRef;
    if (
      input.credential.assetType !== YOUTUBE_CHANNEL_ASSET_TYPE ||
      !ref?.startsWith(VIDEO_PREFIX) ||
      ref.length === VIDEO_PREFIX.length
    ) {
      return Promise.resolve({
        outcome: 'failed',
        reason: 'media_rejected',
        code: 'youtube_prepared_media_invalid',
      });
    }
    return Promise.resolve({
      outcome: 'processing',
      externalPublicationId: ref,
      providerMetadata: {
        phase: 'video_processing',
        placement: input.payload.placement,
      },
    });
  }

  async reconcile(input: ReconciliationInput): Promise<PublicationResult> {
    const id = input.externalPublicationId;
    if (
      input.credential.assetType !== YOUTUBE_CHANNEL_ASSET_TYPE ||
      !id.startsWith(VIDEO_PREFIX) ||
      id.length === VIDEO_PREFIX.length
    ) {
      return {
        outcome: 'failed',
        reason: 'unknown',
        code: 'youtube_reconciliation_identity_invalid',
      };
    }
    const videoId = id.slice(VIDEO_PREFIX.length);

    try {
      const state = await this.api.getVideoState({
        accessToken: input.credential.accessToken,
        videoId,
      });
      if (!state) {
        return {
          outcome: 'failed',
          reason: 'media_rejected',
          code: 'youtube_video_missing',
        };
      }
      if (state.uploadStatus === 'processed') {
        return {
          outcome: 'published',
          externalPublicationId: videoId,
          externalPermalink: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
          publishedAt: new Date(),
          providerMetadata: { assetType: YOUTUBE_CHANNEL_ASSET_TYPE },
        };
      }
      if (state.uploadStatus === 'rejected') {
        return {
          outcome: 'failed',
          reason:
            state.rejectionReason === 'duplicate'
              ? 'duplicate_content'
              : 'media_rejected',
          code: `youtube_rejected_${state.rejectionReason ?? 'unknown'}`,
        };
      }
      if (
        state.uploadStatus === 'failed' ||
        state.uploadStatus === 'deleted' ||
        state.processingStatus === 'failed' ||
        state.processingStatus === 'terminated'
      ) {
        return {
          outcome: 'failed',
          reason: 'media_rejected',
          code: `youtube_upload_${state.failureReason ?? state.uploadStatus ?? 'failed'}`,
        };
      }
      return {
        outcome: 'processing',
        externalPublicationId: id,
        providerMetadata: { phase: 'video_processing' },
      };
    } catch (error) {
      return { outcome: 'failed', ...youtubeFailure(error) };
    }
  }
}
