import { Injectable } from '@nestjs/common';
import type {
  MediaPreparationInput,
  PreparedMedia,
  PublicationExecutionInput,
  PublicationPayload,
  PublicationResult,
  ReconciliationInput,
  RemovalInput,
  SocialPublisherAdapter,
  ValidationIssue,
  ValidationResult,
} from '../social-publisher.adapter';
import { SocialPublisherOperationError } from '../social-publisher.adapter';
import type { PublisherCapabilities } from '../provider-capabilities';
import { META_FACEBOOK_PAGE_CAPABILITIES } from './meta-capabilities';
import { MetaOrganicGraphService } from './meta-organic-graph.service';
import {
  decodeMetaPreparedMediaRef,
  encodeMetaPreparedMediaRef,
  metaPublicationFailure,
} from './meta-publisher.support';

const FACEBOOK_PAGE_ASSET_TYPE = 'facebook_page';
const FACEBOOK_VIDEO_PREFIX = 'fb-video:';
const PREPARED_MEDIA_TTL_MS = 23 * 60 * 60_000;

/** Facebook Page publishing owned by Social Organic. */
@Injectable()
export class FacebookPublisherAdapter implements SocialPublisherAdapter {
  readonly provider = 'meta';
  readonly assetTypes = [FACEBOOK_PAGE_ASSET_TYPE] as const;
  readonly retrySafety = 'non_retryable_after_send' as const;

  constructor(private readonly graph: MetaOrganicGraphService) {}

  capabilities(assetType: string): PublisherCapabilities {
    if (assetType !== FACEBOOK_PAGE_ASSET_TYPE) {
      throw new Error(
        `Unsupported Facebook publisher asset type: ${assetType}`,
      );
    }
    return META_FACEBOOK_PAGE_CAPABILITIES;
  }

  validate(input: PublicationPayload): ValidationResult {
    const issues: ValidationIssue[] = [];
    if (input.assetType !== FACEBOOK_PAGE_ASSET_TYPE) {
      issues.push({ field: 'assetType', reason: 'unsupported_asset_type' });
    }
    if (!META_FACEBOOK_PAGE_CAPABILITIES.placements.includes(input.placement)) {
      issues.push({ field: 'placement', reason: 'unsupported_placement' });
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
    if (input.mediaAssetIds.length > 10) {
      issues.push({ field: 'mediaAssetIds', reason: 'too_many_media_assets' });
    }
    if (input.mediaAssetIds.length > 1 && input.placement !== 'feed') {
      issues.push({ field: 'mediaAssetIds', reason: 'carousel_feed_only' });
    }
    if (
      input.placement === 'feed' &&
      !input.caption &&
      !input.mediaAssetIds.length
    ) {
      issues.push({ field: 'caption', reason: 'content_required' });
    }
    if (
      (input.placement === 'story' || input.placement === 'reel') &&
      !input.mediaAssetIds.length
    ) {
      issues.push({ field: 'mediaAssetId', reason: 'media_required' });
    }
    if (input.placement === 'story' && input.caption) {
      issues.push({ field: 'caption', reason: 'unsupported_story_caption' });
    }

    return issues.length === 0 ? { valid: true } : { valid: false, issues };
  }

  async prepareMedia(input: MediaPreparationInput): Promise<PreparedMedia> {
    try {
      this.requireCredential(input);

      if (input.mimeType.startsWith('image/')) {
        const photo = await this.graph.uploadFacebookPhoto({
          pageId: input.credential.externalAssetId,
          pageAccessToken: input.credential.accessToken,
          sourceUrl: input.sourceUrl,
        });
        return this.prepared('facebook_photo', photo.id);
      }

      const edge =
        input.payload.placement === 'reel'
          ? 'video_reels'
          : input.payload.placement === 'story'
            ? 'video_stories'
            : null;
      if (!edge) {
        throw new SocialPublisherOperationError(
          'media_rejected',
          'facebook_video_placement_unsupported',
        );
      }

      const upload = await this.graph.startFacebookVideoUpload({
        pageId: input.credential.externalAssetId,
        pageAccessToken: input.credential.accessToken,
        edge,
      });
      await this.graph.uploadFacebookVideoByUrl({
        uploadUrl: upload.uploadUrl,
        pageAccessToken: input.credential.accessToken,
        sourceUrl: input.sourceUrl,
      });

      return this.prepared(
        edge === 'video_reels' ? 'facebook_reel' : 'facebook_story_video',
        upload.videoId,
      );
    } catch (error) {
      if (error instanceof SocialPublisherOperationError) throw error;
      const failure = metaPublicationFailure(error);
      throw new SocialPublisherOperationError(failure.reason, failure.code);
    }
  }

  async publish(input: PublicationExecutionInput): Promise<PublicationResult> {
    try {
      if (
        input.credential.assetType !== FACEBOOK_PAGE_ASSET_TYPE ||
        input.payload.assetType !== FACEBOOK_PAGE_ASSET_TYPE
      ) {
        return {
          outcome: 'failed',
          reason: 'payload_invalid',
          code: 'facebook_asset_type_mismatch',
        };
      }

      const decodedMedia = input.preparedMedia.map((entry) =>
        decodeMetaPreparedMediaRef(entry.providerMediaRef),
      );
      if (decodedMedia.some((entry) => entry === null))
        return this.invalidPreparedMedia();
      const media = decodedMedia.filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null,
      );
      const pageId = input.credential.externalAssetId;
      const pageAccessToken = input.credential.accessToken;
      let published: { id: string };

      switch (input.payload.placement) {
        case 'feed':
          if (media.some((entry) => entry.kind !== 'facebook_photo')) {
            return this.invalidPreparedMedia();
          }
          published = await this.graph.publishFacebookFeed({
            pageId,
            pageAccessToken,
            message: input.payload.caption,
            photoIds: media.map((entry) => entry.id),
          });
          break;

        case 'story':
          if (media[0]?.kind === 'facebook_photo') {
            published = await this.graph.publishFacebookPhotoStory({
              pageId,
              pageAccessToken,
              photoId: media[0].id,
            });
          } else if (media[0]?.kind === 'facebook_story_video') {
            published = await this.graph.finishFacebookVideoUpload({
              pageId,
              pageAccessToken,
              edge: 'video_stories',
              videoId: media[0].id,
            });
            return this.processingVideo(published.id);
          } else {
            return this.invalidPreparedMedia();
          }
          break;

        case 'reel':
          if (media[0]?.kind !== 'facebook_reel') {
            return this.invalidPreparedMedia();
          }
          published = await this.graph.finishFacebookVideoUpload({
            pageId,
            pageAccessToken,
            edge: 'video_reels',
            videoId: media[0].id,
            description: input.payload.caption,
          });
          return this.processingVideo(published.id);

        default:
          return {
            outcome: 'failed',
            reason: 'payload_invalid',
            code: 'facebook_placement_unsupported',
          };
      }

      return {
        outcome: 'published',
        externalPublicationId: published.id,
        externalPermalink: null,
        publishedAt: new Date(),
        providerMetadata: { assetType: FACEBOOK_PAGE_ASSET_TYPE },
      };
    } catch (error) {
      return metaPublicationFailure(error);
    }
  }

  async reconcile(input: ReconciliationInput): Promise<PublicationResult> {
    if (
      input.credential.assetType !== FACEBOOK_PAGE_ASSET_TYPE ||
      !input.externalPublicationId.startsWith(FACEBOOK_VIDEO_PREFIX)
    ) {
      return {
        outcome: 'failed',
        reason: 'unknown',
        code: 'facebook_reconciliation_identity_invalid',
      };
    }

    const videoId = input.externalPublicationId.slice(
      FACEBOOK_VIDEO_PREFIX.length,
    );
    if (!videoId) {
      return {
        outcome: 'failed',
        reason: 'unknown',
        code: 'facebook_reconciliation_identity_invalid',
      };
    }

    try {
      const status = await this.graph.getFacebookVideoStatus({
        videoId,
        pageAccessToken: input.credential.accessToken,
      });
      if (status === 'PROCESSING') return this.processingVideo(videoId);
      if (status === 'ERROR') {
        return {
          outcome: 'failed',
          reason: 'media_rejected',
          code: 'facebook_video_processing_error',
        };
      }
      return {
        outcome: 'published',
        externalPublicationId: videoId,
        externalPermalink: null,
        publishedAt: new Date(),
        providerMetadata: { assetType: FACEBOOK_PAGE_ASSET_TYPE },
      };
    } catch (error) {
      return metaPublicationFailure(error);
    }
  }

  async remove(input: RemovalInput): Promise<void> {
    await this.graph.deletePublishedObject({
      objectId: input.externalPublicationId,
      accessToken: input.credential.accessToken,
    });
  }

  private requireCredential(input: MediaPreparationInput): void {
    if (
      input.credential.assetType !== FACEBOOK_PAGE_ASSET_TYPE ||
      input.payload.assetType !== FACEBOOK_PAGE_ASSET_TYPE
    ) {
      throw new SocialPublisherOperationError(
        'payload_invalid',
        'facebook_asset_type_mismatch',
      );
    }
  }

  private prepared(
    kind: 'facebook_photo' | 'facebook_reel' | 'facebook_story_video',
    id: string,
  ): PreparedMedia {
    return {
      providerMediaRef: encodeMetaPreparedMediaRef({ kind, id }),
      expiresAt: new Date(Date.now() + PREPARED_MEDIA_TTL_MS),
    };
  }

  private invalidPreparedMedia(): PublicationResult {
    return {
      outcome: 'failed',
      reason: 'media_rejected',
      code: 'facebook_prepared_media_invalid',
    };
  }

  private processingVideo(videoId: string): PublicationResult {
    return {
      outcome: 'processing',
      externalPublicationId: `${FACEBOOK_VIDEO_PREFIX}${videoId}`,
      providerMetadata: { phase: 'video_processing' },
    };
  }
}
