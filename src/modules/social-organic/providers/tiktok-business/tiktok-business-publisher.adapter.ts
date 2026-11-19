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
import { tiktokPublishFailure } from '../tiktok/tiktok-publisher.adapter';
import {
  TiktokBusinessApiClient,
  tiktokBusinessFailure,
} from './tiktok-business-api.client';
import {
  TIKTOK_BUSINESS_ACCOUNT_ASSET_TYPE,
  TIKTOK_BUSINESS_ACCOUNT_CAPABILITIES,
  TIKTOK_BUSINESS_PROVIDER,
} from './tiktok-business-capabilities';

const SHARE_PREFIX = 'ttb-share:';
const PREPARED_MEDIA_TTL_MS = 60 * 60_000;
/** DOCUMENTED: the caption follows TikTok's 2200-character limit. */
export const TIKTOK_BUSINESS_CAPTION_MAX_LENGTH = 2200;

/** Post choices carried in `payload.providerOptions`. */
export type TiktokBusinessProviderOptions = {
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  /** "Promotional content": the account promotes its own business. */
  isBrandOrganic: boolean;
  /** "Paid partnership" with a third-party brand. */
  isBrandedContent: boolean;
  isAiGenerated: boolean;
};

type BooleanField =
  | 'disableComment'
  | 'disableDuet'
  | 'disableStitch'
  | 'isBrandOrganic'
  | 'isBrandedContent'
  | 'isAiGenerated';

/**
 * Reads the post choices. Interactions default to off and disclosures to
 * false; a non-boolean value is an issue, never a silent default.
 */
export function readTiktokBusinessOptions(
  raw: PublicationPayload['providerOptions'],
): { options: TiktokBusinessProviderOptions; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const read = (field: BooleanField, fallback: boolean) => {
    const value = raw?.[field];
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') {
      issues.push({ field: `providerOptions.${field}`, reason: 'invalid' });
      return fallback;
    }
    return value;
  };
  if (
    raw?.privacyLevel !== undefined &&
    raw.privacyLevel !== 'PUBLIC_TO_EVERYONE'
  ) {
    // The Accounts API publishes public posts only.
    issues.push({
      field: 'providerOptions.privacyLevel',
      reason: 'public_only',
    });
  }
  return {
    options: {
      disableComment: read('disableComment', true),
      disableDuet: read('disableDuet', true),
      disableStitch: read('disableStitch', true),
      isBrandOrganic: read('isBrandOrganic', false),
      isBrandedContent: read('isBrandedContent', false),
      isAiGenerated: read('isAiGenerated', false),
    },
    issues,
  };
}

/**
 * `/business/video/publish/` (Accounts API v1.3). TikTok pulls the file from
 * the presigned URL, so the call happens in `prepareMedia` (like the YouTube
 * upload) and `reconcile` follows `/business/publish/status/`. The video URL's
 * domain must be a verified URL property of the TikTok for Business account.
 */
@Injectable()
export class TiktokBusinessPublisherAdapter implements SocialPublisherAdapter {
  readonly provider = TIKTOK_BUSINESS_PROVIDER;
  readonly assetTypes = [TIKTOK_BUSINESS_ACCOUNT_ASSET_TYPE] as const;
  /** A lost response after the publish call could otherwise duplicate the post. */
  readonly retrySafety = 'non_retryable_after_send' as const;
  /** TikTok recommends a video URL valid for at least 30 minutes. */
  readonly sourceUrlTtlSeconds = 30 * 60;

  constructor(private readonly api: TiktokBusinessApiClient) {}

  capabilities(assetType: string): PublisherCapabilities {
    if (assetType !== TIKTOK_BUSINESS_ACCOUNT_ASSET_TYPE) {
      throw new Error(`Unsupported TikTok Business asset type: ${assetType}`);
    }
    return TIKTOK_BUSINESS_ACCOUNT_CAPABILITIES;
  }

  validate(input: PublicationPayload): ValidationResult {
    const issues: ValidationIssue[] = [];
    if (input.assetType !== TIKTOK_BUSINESS_ACCOUNT_ASSET_TYPE) {
      issues.push({ field: 'assetType', reason: 'unsupported_asset_type' });
    }
    if (
      !TIKTOK_BUSINESS_ACCOUNT_CAPABILITIES.placements.includes(input.placement)
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
    if (input.mediaAssetIds.length !== 1) {
      issues.push({ field: 'mediaAssetIds', reason: 'single_video_required' });
    }
    if (
      [...(input.caption ?? '')].length > TIKTOK_BUSINESS_CAPTION_MAX_LENGTH
    ) {
      issues.push({ field: 'caption', reason: 'caption_too_long' });
    }
    issues.push(...readTiktokBusinessOptions(input.providerOptions).issues);
    return issues.length === 0 ? { valid: true } : { valid: false, issues };
  }

  async prepareMedia(input: MediaPreparationInput): Promise<PreparedMedia> {
    if (
      input.credential.assetType !== TIKTOK_BUSINESS_ACCOUNT_ASSET_TYPE ||
      input.payload.assetType !== TIKTOK_BUSINESS_ACCOUNT_ASSET_TYPE
    ) {
      throw new SocialPublisherOperationError(
        'payload_invalid',
        'tiktok_business_asset_type_mismatch',
      );
    }
    if (!input.mimeType.startsWith('video/') || input.bytes <= 0) {
      throw new SocialPublisherOperationError(
        'media_rejected',
        'tiktok_business_video_required',
      );
    }
    const { options, issues } = readTiktokBusinessOptions(
      input.payload.providerOptions,
    );
    if (issues.length > 0) {
      throw new SocialPublisherOperationError(
        'payload_invalid',
        'tiktok_business_provider_options_invalid',
      );
    }

    const accessToken = input.credential.accessToken;
    const businessId = input.credential.externalAssetId;
    try {
      // The account's own settings can only tighten the interactions.
      const settings = await this.api.videoSettings({
        accessToken,
        businessId,
      });
      const shareId = await this.api.publishVideo({
        accessToken,
        businessId,
        videoUrl: input.sourceUrl,
        post: {
          caption: input.payload.caption ?? '',
          isBrandOrganic: options.isBrandOrganic,
          isBrandedContent: options.isBrandedContent,
          isAiGenerated: options.isAiGenerated,
          disableComment: options.disableComment || settings.commentDisabled,
          disableDuet: options.disableDuet || settings.duetDisabled,
          disableStitch: options.disableStitch || settings.stitchDisabled,
          ...(input.payload.cover?.image
            ? { customThumbnailUrl: input.payload.cover.image.sourceUrl }
            : input.payload.cover?.timestampMs != null
              ? { thumbnailOffsetMs: input.payload.cover.timestampMs }
              : {}),
        },
      });
      return {
        providerMediaRef: `${SHARE_PREFIX}${shareId}`,
        expiresAt: new Date(Date.now() + PREPARED_MEDIA_TTL_MS),
      };
    } catch (error) {
      const failure = tiktokBusinessFailure(error);
      throw new SocialPublisherOperationError(failure.reason, failure.code);
    }
  }

  publish(input: PublicationExecutionInput): Promise<PublicationResult> {
    const ref = input.preparedMedia[0]?.providerMediaRef;
    if (
      input.credential.assetType !== TIKTOK_BUSINESS_ACCOUNT_ASSET_TYPE ||
      !ref?.startsWith(SHARE_PREFIX) ||
      ref.length === SHARE_PREFIX.length
    ) {
      return Promise.resolve({
        outcome: 'failed',
        reason: 'media_rejected',
        code: 'tiktok_business_prepared_media_invalid',
      });
    }
    return Promise.resolve({
      outcome: 'processing',
      externalPublicationId: ref,
      providerMetadata: {
        phase: 'tiktok_business_processing',
        placement: input.payload.placement,
      },
    });
  }

  async reconcile(input: ReconciliationInput): Promise<PublicationResult> {
    const id = input.externalPublicationId;
    if (
      input.credential.assetType !== TIKTOK_BUSINESS_ACCOUNT_ASSET_TYPE ||
      !id.startsWith(SHARE_PREFIX) ||
      id.length === SHARE_PREFIX.length
    ) {
      return {
        outcome: 'failed',
        reason: 'unknown',
        code: 'tiktok_business_reconciliation_identity_invalid',
      };
    }
    const publishId = id.slice(SHARE_PREFIX.length);

    try {
      const state = await this.api.publishStatus({
        accessToken: input.credential.accessToken,
        businessId: input.credential.externalAssetId,
        publishId,
      });
      switch (state.status) {
        case 'PUBLISH_COMPLETE':
          // Post ids can take up to three minutes; keep waiting for them.
          if (!state.postIds.length) {
            return {
              outcome: 'processing',
              externalPublicationId: id,
              providerMetadata: { phase: 'tiktok_business_awaiting_post_id' },
            };
          }
          return {
            outcome: 'published',
            externalPublicationId: state.postIds[0],
            externalPermalink: null,
            publishedAt: new Date(),
            providerMetadata: {
              assetType: TIKTOK_BUSINESS_ACCOUNT_ASSET_TYPE,
              publishId,
            },
          };
        case 'FAILED': {
          const failure = tiktokPublishFailure(state.reason);
          return {
            outcome: 'failed',
            reason: failure.reason,
            code: failure.code.replace(/^tiktok_/, 'tiktok_business_'),
          };
        }
        case 'SEND_TO_USER_INBOX':
          return {
            outcome: 'failed',
            reason: 'unknown',
            code: 'tiktok_business_sent_to_inbox',
          };
        default:
          return {
            outcome: 'processing',
            externalPublicationId: id,
            providerMetadata: { phase: 'tiktok_business_processing' },
          };
      }
    } catch (error) {
      return { outcome: 'failed', ...tiktokBusinessFailure(error) };
    }
  }
}
