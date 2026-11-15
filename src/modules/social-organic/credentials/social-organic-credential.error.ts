export type SocialOrganicCredentialErrorCode =
  | 'asset_not_found'
  | 'connection_not_connected'
  | 'credential_removed'
  | 'asset_not_active'
  | 'publishing_not_enabled'
  | 'analytics_scope_missing'
  | 'asset_timezone_unresolved'
  | 'asset_timezone_invalid'
  | 'asset_unhealthy'
  | 'unsupported_analytics_asset_type'
  | 'asset_provider_mismatch'
  | 'unsupported_authorization_method'
  /** OR0: the provider refused the refresh (or the grant is gone): reconnect. */
  | 'credential_expired'
  /** OR0: the refresh could not complete right now; retrying is safe. */
  | 'credential_refresh_failed';

/** A stable, sanitized refusal code. No provider or crypto detail may escape. */
export class SocialOrganicCredentialError extends Error {
  readonly code: SocialOrganicCredentialErrorCode;

  constructor(code: SocialOrganicCredentialErrorCode) {
    super(code);
    this.name = 'SocialOrganicCredentialError';
    this.code = code;
  }
}
