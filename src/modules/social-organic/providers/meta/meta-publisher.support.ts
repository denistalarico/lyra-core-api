import type { SocialPublicationFailureReason } from '../../publication/entities/social-publication.entity';
import { MetaOrganicGraphError } from './meta-organic-graph.error';

export type MetaPreparedMediaRef = {
  readonly kind:
    | 'facebook_photo'
    | 'facebook_reel'
    | 'facebook_story_video'
    | 'instagram_container';
  readonly id: string;
};

export type MetaPublicationFailure = {
  readonly outcome: 'failed';
  readonly reason: SocialPublicationFailureReason;
  readonly code: string;
};

export function encodeMetaPreparedMediaRef(ref: MetaPreparedMediaRef): string {
  return JSON.stringify(ref);
}

export function decodeMetaPreparedMediaRef(
  value: string,
): MetaPreparedMediaRef | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.id !== 'string' || !parsed.id.trim()) {
    return null;
  }
  if (
    parsed.kind !== 'facebook_photo' &&
    parsed.kind !== 'facebook_reel' &&
    parsed.kind !== 'facebook_story_video' &&
    parsed.kind !== 'instagram_container'
  ) {
    return null;
  }

  return { kind: parsed.kind, id: parsed.id.trim() };
}

export function metaPublicationFailure(error: unknown): MetaPublicationFailure {
  if (!(error instanceof MetaOrganicGraphError)) {
    return {
      outcome: 'failed',
      reason: 'unknown',
      code: 'meta_publish_failed',
    };
  }

  const reason: SocialPublicationFailureReason =
    error.kind === 'credential_invalid'
      ? 'credential_expired'
      : error.kind === 'permission_denied'
        ? 'permission_lost'
        : error.kind === 'rate_limited'
          ? 'rate_limited'
          : error.kind === 'transient'
            ? 'provider_unavailable'
            : error.code === 'meta_request_rejected'
              ? 'payload_invalid'
              : 'unknown';

  return { outcome: 'failed', reason, code: error.code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
