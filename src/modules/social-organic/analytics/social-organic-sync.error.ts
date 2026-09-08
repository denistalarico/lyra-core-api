export type SocialOrganicSyncErrorCode =
  | 'run_window_missing'
  | 'invalid_sync_window'
  | 'unsupported_analytics_asset_type';

/** Stable internal queue-plan refusal. Raw provider data never reaches it. */
export class SocialOrganicSyncError extends Error {
  constructor(readonly code: SocialOrganicSyncErrorCode) {
    super(code);
    this.name = 'SocialOrganicSyncError';
  }
}
