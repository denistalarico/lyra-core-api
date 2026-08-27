import { HttpException, HttpStatus } from '@nestjs/common';
import { SocialAdCredentialError } from '../credentials/social-ad-credential.error';
import type { SocialAdCredentialErrorCode } from '../credentials/social-ad-credential.error';
import { MetaGraphError } from '../services/meta-graph-error';
import {
  SocialAdInsightsTruncatedError,
  SocialAdInsightsWindowNotClosedError,
} from './social-ad-insights.error';
import { SocialAdSyncDisabledError } from './social-ad-sync-run.error';

/**
 * Turns a sync failure into an HTTP answer that says something true.
 *
 * Two failure vocabularies reach the manual endpoint, and neither was designed
 * for HTTP: `SocialAdCredentialError` carries a stable code aimed at a worker,
 * and `MetaGraphError` carries a *kind* aimed at a retry policy. Mapping them
 * here rather than at each throw site keeps the codes free of HTTP concerns —
 * and keeps the endpoint from inheriting `MetaGraphError`'s base class, which
 * is `BadRequestException` for S1 reasons and would answer 400 for a rate limit.
 *
 * Every body is a fixed message plus a code. The codes are safe by
 * construction: `SocialAdCredentialErrorCode` names a condition and never a
 * value, and `MetaGraphError`'s message has already been through
 * `sanitizeMetaErrorMessage`. No token, no URL, no raw provider string.
 */

/**
 * What each credential refusal means over HTTP.
 *
 * `connection_not_found` is the only 404, and it is the answer for a connection
 * in another tenant, another workspace or another managed client — identical to
 * an id that never existed, because the lookup that produced it was scoped.
 * Confirming existence would make the endpoint an enumeration oracle.
 *
 * Everything else is 409: the connection is real and in scope, and it is in a
 * state that a person has to change (reconnect, re-select an account, fix
 * configuration). None of them is a client error in the request, and none is
 * fixed by retrying.
 */
const CREDENTIAL_STATUS: Record<SocialAdCredentialErrorCode, HttpStatus> = {
  connection_not_found: HttpStatus.NOT_FOUND,
  unsupported_provider: HttpStatus.CONFLICT,
  unsupported_authorization_method: HttpStatus.CONFLICT,
  connection_not_connected: HttpStatus.CONFLICT,
  credential_removed: HttpStatus.CONFLICT,
  account_not_bound: HttpStatus.CONFLICT,
  token_missing: HttpStatus.CONFLICT,
  token_expired: HttpStatus.CONFLICT,
  credential_decryption_failed: HttpStatus.CONFLICT,
  timezone_missing: HttpStatus.CONFLICT,
  timezone_unsupported: HttpStatus.CONFLICT,
  internal_scope_denied: HttpStatus.CONFLICT,
  system_user_token_missing: HttpStatus.CONFLICT,
  internal_account_not_configured: HttpStatus.CONFLICT,
  internal_account_drift: HttpStatus.CONFLICT,
};

const CREDENTIAL_MESSAGE: Record<SocialAdCredentialErrorCode, string> = {
  connection_not_found: 'Connection not found.',
  unsupported_provider: 'This provider has no reader yet.',
  unsupported_authorization_method:
    'This connection was authorized in a way this server does not support.',
  connection_not_connected: 'This connection is not connected.',
  credential_removed: 'This connection no longer holds a credential.',
  account_not_bound: 'This connection has no ad account selected.',
  token_missing: 'This connection needs to be authorized again.',
  token_expired: 'This connection needs to be authorized again.',
  credential_decryption_failed: 'This connection needs to be authorized again.',
  timezone_missing: 'This ad account has no timezone.',
  timezone_unsupported: 'This ad account reports a timezone we cannot read.',
  internal_scope_denied: 'This connection is not available in this context.',
  system_user_token_missing: 'The Social System User token is not configured.',
  internal_account_not_configured:
    'The internal Social ad account is not configured.',
  internal_account_drift:
    'The configured internal ad account no longer matches this connection.',
};

/**
 * What each Graph failure means over HTTP.
 *
 * The distinction that matters is who has to act: 429 and 503 tell a caller to
 * come back, 409 tells them the connection needs attention, and 502 says Meta
 * refused in a way that repeating will not fix. `auth` deliberately does not
 * answer 401 — the caller's own session is fine; it is the stored credential
 * that is not.
 */
const GRAPH_STATUS: Record<MetaGraphError['kind'], HttpStatus> = {
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
  transient: HttpStatus.SERVICE_UNAVAILABLE,
  auth: HttpStatus.CONFLICT,
  permanent: HttpStatus.BAD_GATEWAY,
};

/** A failure reduced to what may be shown: a stable code and a fixed message. */
export type SocialAdSyncFailure = {
  status: HttpStatus;
  code: string;
  message: string;
  reason?: string;
  retryAfterMs?: number;
  /** Latest settled day, on a window that reached into an unfinished one. */
  maxUntil?: string;
  /** The ad account's zone, which decided the day above. */
  timezone?: string;
};

/**
 * Describes a failure without deciding what to do about it.
 *
 * Split out from the mapper below because a failure has two destinations now.
 * A run that wrote nothing throws, and this becomes the HTTP error. A run that
 * already wrote real facts must not throw — that would report "failed" for
 * days that are now stored — so the same description travels inside the summary
 * instead, naming the level that did not complete.
 */
export function describeSocialAdSyncFailure(
  error: unknown,
): SocialAdSyncFailure {
  if (error instanceof SocialAdCredentialError) {
    return {
      status: CREDENTIAL_STATUS[error.code],
      code: error.code,
      message: CREDENTIAL_MESSAGE[error.code],
    };
  }

  if (error instanceof SocialAdInsightsTruncatedError) {
    return {
      status: HttpStatus.CONFLICT,
      code: 'insights_window_truncated',
      // The repair is the caller's, and it is a smaller window — not a retry,
      // which would truncate at exactly the same place.
      message: 'This window returned too many rows. Request a shorter range.',
    };
  }

  if (error instanceof SocialAdInsightsWindowNotClosedError) {
    return {
      status: HttpStatus.CONFLICT,
      code: 'insights_window_not_closed',
      // The boundary is the answer, not a hint: it depends on the account's own
      // clock, which the caller cannot derive from anything in the request.
      message: `This window includes a day the ad account has not finished. Request up to ${error.maxUntil}.`,
      maxUntil: error.maxUntil,
      timezone: error.timezone,
    };
  }

  if (error instanceof SocialAdSyncDisabledError) {
    return {
      // 503, not 403: nothing about the caller or the connection is wrong, and
      // the condition is temporary by design — an operator turns it back on.
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'sync_disabled',
      message: 'Ad syncing is currently turned off on this server.',
    };
  }

  if (error instanceof MetaGraphError) {
    return {
      status: GRAPH_STATUS[error.kind],
      code: `meta_${error.kind}`,
      // Already sanitized upstream: either a fixed string of ours or a provider
      // message with URLs, tokens and secrets redacted.
      message: error.message,
      // Only for auth, where it separates "re-authorize" from "grant a role in
      // Business Manager" — two very different repairs.
      ...(error.authReason ? { reason: error.authReason } : {}),
      // Meta's own advice about when to come back, when it gave any.
      ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}),
    };
  }

  // An unclassified error is a bug. It gets a code that says so rather than a
  // reassuring one, and the message stays generic because its own text has been
  // through no sanitizer.
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'internal_error',
    message: 'The sync failed.',
  };
}

export function mapSocialAdSyncError(error: unknown): unknown {
  if (
    error instanceof SocialAdCredentialError ||
    error instanceof SocialAdInsightsTruncatedError ||
    error instanceof SocialAdInsightsWindowNotClosedError ||
    error instanceof SocialAdSyncDisabledError ||
    error instanceof MetaGraphError
  ) {
    const { status, ...body } = describeSocialAdSyncFailure(error);

    return new HttpException({ statusCode: status, ...body }, status);
  }

  // Anything else is a bug rather than a known failure, and dressing it up as a
  // classified error would hide it. It keeps travelling as-is and becomes a 500.
  return error;
}
