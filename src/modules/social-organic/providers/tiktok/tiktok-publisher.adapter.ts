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
import {
  TiktokApiClient,
  tiktokFailure,
  type TiktokPostInfo,
} from './tiktok-api.client';
import {
  TIKTOK_ACCOUNT_ASSET_TYPE,
  TIKTOK_ACCOUNT_CAPABILITIES,
  TIKTOK_PROVIDER,
} from './tiktok-capabilities';

const PUBLISH_PREFIX = 'tt-publish:';
const PREPARED_MEDIA_TTL_MS = 60 * 60_000;
/** DOCUMENTED: `post_info.title` is at most 2200 UTF-16 runes. */
export const TIKTOK_TITLE_MAX_LENGTH = 2200;

/**
 * D-I10: until the client passes the Content Posting audit, TikTok accepts only
 * private posts (`unaudited_client_can_only_post_to_private_accounts`). Flip
 * this after the audit; the creator-info route and the FE read it from here.
 */
export const TIKTOK_CLIENT_AUDITED = false;
export const TIKTOK_UNAUDITED_PRIVACY_LEVEL = 'SELF_ONLY';

/** Creator choices (D-I10) carried in `payload.providerOptions`. */
export type TiktokProviderOptions = {
  privacyLevel: string;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
};

const PRIVACY_LEVELS = [
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY',
];

/** Reads the creator's choices; absent fields fall back to the safe default. */
export function readTiktokOptions(raw: PublicationPayload['providerOptions']): {
  options: TiktokProviderOptions;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const bool = (field: string, fallback: boolean) => {
    const value = raw?.[field];
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') {
      issues.push({ field: `providerOptions.${field}`, reason: 'invalid' });
      return fallback;
    }
    return value;
  };
  let privacyLevel = TIKTOK_UNAUDITED_PRIVACY_LEVEL;
  const requested = raw?.privacyLevel;
  if (requested !== undefined) {
    if (typeof requested !== 'string' || !PRIVACY_LEVELS.includes(requested)) {
      issues.push({ field: 'providerOptions.privacyLevel', reason: 'invalid' });
    } else if (
      !TIKTOK_CLIENT_AUDITED &&
      requested !== TIKTOK_UNAUDITED_PRIVACY_LEVEL
    ) {
      issues.push({
        field: 'providerOptions.privacyLevel',
        reason: 'unaudited_client_private_only',
      });
    } else {
      privacyLevel = requested;
    }
  }
  return {
    options: {
      privacyLevel,
      // Interactions default to off: the creator must opt in on the FE screen.
      disableComment: bool('disableComment', true),
      disableDuet: bool('disableDuet', true),
      disableStitch: bool('disableStitch', true),
    },
    issues,
  };
}

/**
 * TikTok Direct Post (D-I10). `creator_info/query` runs right before every
 * post (a TikTok rule), the upload is `FILE_UPLOAD` in `prepareMedia`, and
 * `reconcile` follows `status/fetch` until `PUBLISH_COMPLETE`.
 */
@Injectable()
export class TiktokPublisherAdapter implements SocialPublisherAdapter {
  readonly provider = TIKTOK_PROVIDER;
  readonly assetTypes = [TIKTOK_ACCOUNT_ASSET_TYPE] as const;
  /** A lost response after the last chunk could otherwise duplicate the post. */
  readonly retrySafety = 'non_retryable_after_send' as const;

  constructor(private readonly api: TiktokApiClient) {}

  capabilities(assetType: string): PublisherCapabilities {
    if (assetType !== TIKTOK_ACCOUNT_ASSET_TYPE) {
      throw new Error(`Unsupported TikTok publisher asset type: ${assetType}`);
    }
    return TIKTOK_ACCOUNT_CAPABILITIES;
  }

  validate(input: PublicationPayload): ValidationResult {
    const issues: ValidationIssue[] = [];
    if (input.assetType !== TIKTOK_ACCOUNT_ASSET_TYPE) {
      issues.push({ field: 'assetType', reason: 'unsupported_asset_type' });
    }
    if (!TIKTOK_ACCOUNT_CAPABILITIES.placements.includes(input.placement)) {
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
    if ((input.caption ?? '').length > TIKTOK_TITLE_MAX_LENGTH) {
      issues.push({ field: 'caption', reason: 'caption_too_long' });
    }
    issues.push(...readTiktokOptions(input.providerOptions).issues);
    return issues.length === 0 ? { valid: true } : { valid: false, issues };
  }

  async prepareMedia(input: MediaPreparationInput): Promise<PreparedMedia> {
    if (
      input.credential.assetType !== TIKTOK_ACCOUNT_ASSET_TYPE ||
      input.payload.assetType !== TIKTOK_ACCOUNT_ASSET_TYPE
    ) {
      throw new SocialPublisherOperationError(
        'payload_invalid',
        'tiktok_asset_type_mismatch',
      );
    }
    if (!input.mimeType.startsWith('video/') || input.bytes <= 0) {
      throw new SocialPublisherOperationError(
        'media_rejected',
        'tiktok_video_required',
      );
    }
    const { options, issues } = readTiktokOptions(
      input.payload.providerOptions,
    );
    if (issues.length > 0) {
      throw new SocialPublisherOperationError(
        'payload_invalid',
        'tiktok_provider_options_invalid',
      );
    }

    try {
      const accessToken = input.credential.accessToken;
      // Mandatory before every post; the choices must match what TikTok offers.
      const creator = await this.api.creatorInfo(accessToken);
      if (!creator.privacyLevelOptions.includes(options.privacyLevel)) {
        throw new SocialPublisherOperationError(
          'payload_invalid',
          'tiktok_privacy_level_option_mismatch',
        );
      }
      const post: TiktokPostInfo = {
        title: input.payload.caption ?? '',
        privacyLevel: options.privacyLevel,
        // The creator's own account settings can only tighten the choice.
        disableComment: options.disableComment || creator.commentDisabled,
        disableDuet: options.disableDuet || creator.duetDisabled,
        disableStitch: options.disableStitch || creator.stitchDisabled,
        ...(input.payload.cover?.timestampMs != null
          ? { coverTimestampMs: input.payload.cover.timestampMs }
          : {}),
      };
      const init = await this.api.initDirectPost({
        accessToken,
        post,
        videoSize: input.bytes,
      });
      await this.api.uploadFromSource({
        uploadUrl: init.uploadUrl,
        sourceUrl: input.sourceUrl,
        totalBytes: input.bytes,
        mimeType: input.mimeType,
      });
      return {
        providerMediaRef: `${PUBLISH_PREFIX}${init.publishId}`,
        expiresAt: new Date(Date.now() + PREPARED_MEDIA_TTL_MS),
      };
    } catch (error) {
      if (error instanceof SocialPublisherOperationError) throw error;
      const failure = tiktokFailure(error);
      throw new SocialPublisherOperationError(failure.reason, failure.code);
    }
  }

  publish(input: PublicationExecutionInput): Promise<PublicationResult> {
    const ref = input.preparedMedia[0]?.providerMediaRef;
    if (
      input.credential.assetType !== TIKTOK_ACCOUNT_ASSET_TYPE ||
      !ref?.startsWith(PUBLISH_PREFIX) ||
      ref.length === PUBLISH_PREFIX.length
    ) {
      return Promise.resolve({
        outcome: 'failed',
        reason: 'media_rejected',
        code: 'tiktok_prepared_media_invalid',
      });
    }
    return Promise.resolve({
      outcome: 'processing',
      externalPublicationId: ref,
      providerMetadata: {
        phase: 'tiktok_processing',
        placement: input.payload.placement,
      },
    });
  }

  async reconcile(input: ReconciliationInput): Promise<PublicationResult> {
    const id = input.externalPublicationId;
    if (
      input.credential.assetType !== TIKTOK_ACCOUNT_ASSET_TYPE ||
      !id.startsWith(PUBLISH_PREFIX) ||
      id.length === PUBLISH_PREFIX.length
    ) {
      return {
        outcome: 'failed',
        reason: 'unknown',
        code: 'tiktok_reconciliation_identity_invalid',
      };
    }
    const publishId = id.slice(PUBLISH_PREFIX.length);

    try {
      const state = await this.api.publishStatus({
        accessToken: input.credential.accessToken,
        publishId,
      });
      switch (state.status) {
        case 'PUBLISH_COMPLETE':
          return {
            outcome: 'published',
            // A private (SELF_ONLY) or still-moderated post has no public id.
            externalPublicationId: state.publicPostIds[0] ?? publishId,
            externalPermalink: null,
            publishedAt: new Date(),
            providerMetadata: {
              assetType: TIKTOK_ACCOUNT_ASSET_TYPE,
              publishId,
              publiclyAvailable: state.publicPostIds.length > 0,
            },
          };
        case 'FAILED':
          return {
            outcome: 'failed',
            ...tiktokPublishFailure(state.failReason),
          };
        case 'SEND_TO_USER_INBOX':
          // A draft, not a Direct Post: nothing was published by Lyra.
          return {
            outcome: 'failed',
            reason: 'unknown',
            code: 'tiktok_sent_to_inbox',
          };
        default:
          return {
            outcome: 'processing',
            externalPublicationId: id,
            providerMetadata: { phase: 'tiktok_processing' },
          };
      }
    } catch (error) {
      return { outcome: 'failed', ...tiktokFailure(error) };
    }
  }
}

/** `fail_reason` values DOCUMENTED 2026-11-16 (status/fetch page). */
export function tiktokPublishFailure(reason: string | null): {
  reason: SocialPublisherOperationError['reason'];
  code: string;
} {
  const code = `tiktok_${reason ?? 'failed'}`;
  switch (reason) {
    case 'file_format_check_failed':
    case 'duration_check_failed':
    case 'frame_rate_check_failed':
    case 'picture_size_check_failed':
    case 'video_pull_failed':
    case 'photo_pull_failed':
      return { reason: 'media_rejected', code };
    case 'internal':
      return { reason: 'provider_unavailable', code };
    case 'auth_removed':
      return { reason: 'credential_expired', code };
    case 'spam_risk_too_many_posts':
      return { reason: 'rate_limited', code };
    case 'spam_risk_user_banned_from_posting':
    case 'spam_risk':
      return { reason: 'permission_lost', code };
    case 'spam_risk_text':
      return { reason: 'payload_invalid', code };
    default:
      return { reason: 'unknown', code };
  }
}
