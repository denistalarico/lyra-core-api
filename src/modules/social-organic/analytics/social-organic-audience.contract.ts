import type { SocialOrganicAudienceKind } from './entities/social-organic-audience-daily.entity';

/**
 * One audience snapshot bucket, normalized, ready to be written.
 *
 * Carries its own scope, like the paid breakdown contract and for the same
 * reason: the writer then has a single complete argument, and there is no second
 * place where a batch could be paired with the wrong asset.
 */
export type NormalizedOrganicAudienceDaily = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  provider: string;
  /** The day of observation. A lifetime total has no period of its own. */
  metricDate: string;
  assetTimezone: string;
  breakdownKind: SocialOrganicAudienceKind;
  breakdownKey: string;
  /** A decimal string for `numeric`. Never summed across days. */
  value: string;
  observedAt: Date;
  syncedAt: Date;
  syncRunId: string | null;
};

/**
 * What one asset's audience pass did.
 *
 * `dimensions` counts the dimensions that returned buckets, not the ones asked
 * for. The difference is the normal case rather than an error: Meta withholds
 * `follower_demographics` entirely for accounts under 100 followers, and an
 * account that has not reached it yet is not a failure to report.
 */
export type SocialOrganicAudienceSyncSummary = {
  assetId: string;
  metricDate: string;
  dimensions: number;
  rowsWritten: number;
  apiCalls: number;
};
