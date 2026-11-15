import type { SocialOrganicAssetEntity } from '../entities';

export const SOCIAL_ORGANIC_HEALTH_PROVIDERS = Symbol(
  'SOCIAL_ORGANIC_HEALTH_PROVIDERS',
);

/**
 * D-I4 (c): one "can this still publish?" check per provider, behind the
 * hourly `SocialOrganicHealthScheduler`. The scheduler only ever hands an
 * implementation assets whose `provider` it declared.
 */
export interface SocialOrganicHealthProvider {
  /** Persisted `provider` keys of the assets this implementation checks. */
  readonly providers: readonly string[];
  listEligibleForScheduledCheck(): Promise<SocialOrganicAssetEntity[]>;
  /** Classifies and persists the asset health. Read-only at the provider. */
  runCheck(asset: SocialOrganicAssetEntity): Promise<unknown>;
}
