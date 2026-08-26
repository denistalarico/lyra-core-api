import { HttpException, HttpStatus } from '@nestjs/common';
import { SocialAdCredentialError } from '../credentials/social-ad-credential.error';
import type { SocialAdCredentialErrorCode } from '../credentials/social-ad-credential.error';
import { MetaGraphError } from '../services/meta-graph-error';

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

export function mapSocialAdSyncError(error: unknown): unknown {
  if (error instanceof SocialAdCredentialError) {
    return new HttpException(
      {
        statusCode: CREDENTIAL_STATUS[error.code],
        code: error.code,
        message: CREDENTIAL_MESSAGE[error.code],
      },
      CREDENTIAL_STATUS[error.code],
    );
  }

  if (error instanceof MetaGraphError) {
    const status = GRAPH_STATUS[error.kind];

    return new HttpException(
      {
        statusCode: status,
        code: `meta_${error.kind}`,
        // Already sanitized upstream: either a fixed string of ours or a
        // provider message with URLs, tokens and secrets redacted.
        message: error.message,
        // Only for auth, where it separates "re-authorize" from "grant a role
        // in Business Manager" — two very different repairs.
        ...(error.authReason ? { reason: error.authReason } : {}),
        // Meta's own advice about when to come back, when it gave any.
        ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}),
      },
      status,
    );
  }

  // Anything else is a bug rather than a known failure, and dressing it up as a
  // classified error would hide it. It keeps travelling as-is and becomes a 500.
  return error;
}
