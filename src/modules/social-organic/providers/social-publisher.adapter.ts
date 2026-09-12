import type { ResolvedOrganicCredential } from '../credentials/resolved-organic-credential';
import type { SocialPublicationFailureReason } from '../publication/entities/social-publication.entity';
import type { PublisherCapabilities } from './provider-capabilities';

/** Provider-neutral shape of the content an operator wants published. */
export type PublicationPayload = {
  readonly assetType: string;
  readonly placement: string;
  readonly caption: string | null;
  readonly firstComment: string | null;
  readonly hashtags: readonly string[];
  readonly cta: string | null;
  readonly mediaAssetId: string | null;
  readonly mediaAssetIds: readonly string[];
  /** Lyra-owned desired publish time; never a provider-side schedule (ADR-015). */
  readonly scheduledAt: Date;
};

export type ValidationIssue = {
  readonly field: string;
  readonly reason: string;
};

export type ValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly issues: readonly ValidationIssue[] };

/** Safe provider-operation failure for adapter stages that cannot return a result. */
export class SocialPublisherOperationError extends Error {
  constructor(
    readonly reason: SocialPublicationFailureReason,
    readonly code: string,
  ) {
    super(code);
    this.name = 'SocialPublisherOperationError';
  }
}

export type MediaPreparationInput = {
  readonly credential: ResolvedOrganicCredential;
  readonly payload: PublicationPayload;
  /** Signed, time-limited location the adapter may fetch the source media from. */
  readonly sourceUrl: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly mediaIndex: number;
  readonly mediaCount: number;
};

/** What the provider needs at `publish()` time to attach the already-prepared media. */
export type PreparedMedia = {
  readonly providerMediaRef: string;
  readonly expiresAt: Date | null;
};

export type PublicationExecutionInput = {
  readonly credential: ResolvedOrganicCredential;
  readonly payload: PublicationPayload;
  readonly preparedMedia: readonly PreparedMedia[];
  /** Caller-owned key; adapters MUST make `publish` idempotent w.r.t. this value. */
  readonly idempotencyKey: string;
};

export type PublicationResult =
  | {
      readonly outcome: 'published';
      readonly externalPublicationId: string;
      readonly externalPermalink: string | null;
      readonly publishedAt: Date;
      readonly providerMetadata: Record<string, unknown>;
    }
  | {
      /** Accepted by the provider but not yet confirmed live; `reconcile()` follows. */
      readonly outcome: 'processing';
      readonly externalPublicationId: string;
      readonly providerMetadata: Record<string, unknown>;
    }
  | {
      readonly outcome: 'failed';
      readonly reason: SocialPublicationFailureReason;
      readonly code: string;
    };

export type ReconciliationInput = {
  readonly credential: ResolvedOrganicCredential;
  readonly externalPublicationId: string;
};

export type RemovalInput = {
  readonly credential: ResolvedOrganicCredential;
  readonly externalPublicationId: string;
};

/**
 * The contract every provider implements. Blueprint §7.2.
 *
 * Two rules that keep this from rotting:
 * 1. An optional method means the provider genuinely cannot do this — it is
 *    omitted, never implemented as a stub that throws.
 * 2. No method returns a provider-shaped object. Raw provider payloads belong
 *    in `provider_metadata`, never in a return type a caller can see.
 */
export interface SocialPublisherAdapter {
  readonly provider: string;
  /** Asset types owned by this adapter under the provider key. */
  readonly assetTypes: readonly string[];
  /** Blueprint §20.1 Layer 2 contract for a lost publish response. */
  readonly retrySafety:
    | 'provider_idempotency_key'
    | 'pre_retry_existence_check'
    | 'non_retryable_after_send';

  capabilities(assetType: string): PublisherCapabilities;

  validate(input: PublicationPayload): ValidationResult;

  prepareMedia(input: MediaPreparationInput): Promise<PreparedMedia>;

  publish(input: PublicationExecutionInput): Promise<PublicationResult>;

  reconcile?(input: ReconciliationInput): Promise<PublicationResult>;

  remove?(input: RemovalInput): Promise<void>;
}
