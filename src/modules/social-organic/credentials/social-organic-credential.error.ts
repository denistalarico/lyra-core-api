export type SocialOrganicCredentialErrorCode =
  | 'asset_not_found'
  | 'connection_not_connected'
  | 'credential_removed'
  | 'asset_not_active'
  | 'publishing_not_enabled'
  | 'asset_provider_mismatch'
  | 'unsupported_authorization_method';

/** A stable, sanitized refusal code. No provider or crypto detail may escape. */
export class SocialOrganicCredentialError extends Error {
  readonly code: SocialOrganicCredentialErrorCode;

  constructor(code: SocialOrganicCredentialErrorCode) {
    super(code);
    this.name = 'SocialOrganicCredentialError';
    this.code = code;
  }
}
