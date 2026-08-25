/**
 * Why a connection could not produce a usable credential.
 *
 * Every value is a stable, sanitized code: it names a condition, never a
 * value, an id or anything a provider said. These are written to
 * `last_sync_error`, which the settings screen renders, and they are what a
 * future sync run records when it gives up — so they have to be safe by
 * construction rather than by whoever writes the next log line.
 *
 * Codes are grouped by who has to act, which is the only distinction a caller
 * ever needs from them:
 *
 * - the connection is not in a state to be used  → an operator reconnects
 * - the credential is unusable                   → an operator reconnects
 * - configuration is wrong                       → an operator edits the server
 * - the scope is not allowed here                → nobody acts; this is a refusal
 */
export type SocialAdCredentialErrorCode =
  /** No connection with that id inside the caller's scope. */
  | 'connection_not_found'
  /** Provider has no reader yet. Not a failure of the connection. */
  | 'unsupported_provider'
  /** A method this resolver does not know. Fail rather than guess a branch. */
  | 'unsupported_authorization_method'
  | 'connection_not_connected'
  | 'credential_removed'
  /** Connected, but no ad account was ever bound — or it is malformed. */
  | 'account_not_bound'
  | 'token_missing'
  | 'token_expired'
  | 'credential_decryption_failed'
  /** The account has no timezone, so no date could be attributed to a day. */
  | 'timezone_missing'
  /** The stored timezone is not a zone this runtime knows. */
  | 'timezone_unsupported'
  /** The internal exception was invoked from a scope it does not cover. */
  | 'internal_scope_denied'
  | 'system_user_token_missing'
  | 'internal_account_not_configured'
  /** Configuration now names a different account than this row is bound to. */
  | 'internal_account_drift';

/**
 * A refusal to resolve a credential.
 *
 * A plain `Error` rather than a Nest HTTP exception on purpose. The intended
 * callers are a sync service and a worker, where an HTTP status is meaningless
 * and where the interesting question is which code came back — the same code
 * that ends up in `last_sync_error`. A controller that ever needs to surface
 * one can map it, which is a decision that belongs at that boundary and not
 * here.
 */
export class SocialAdCredentialError extends Error {
  readonly code: SocialAdCredentialErrorCode;

  constructor(code: SocialAdCredentialErrorCode) {
    // The code *is* the message: there is no free-text half that could pick up
    // a token, an account id or a provider string on its way to a log.
    super(code);
    this.name = 'SocialAdCredentialError';
    this.code = code;
  }
}
