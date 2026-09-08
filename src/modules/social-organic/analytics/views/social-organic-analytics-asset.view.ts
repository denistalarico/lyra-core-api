/**
 * One organic asset for the analytics dashboard's picker.
 *
 * A strict subset of what `SocialOrganicConnectionEntity`/`SocialOrganicAssetEntity`
 * hold: no encrypted token, no OAuth state, no raw provider metadata. Mirrors
 * why `SocialAnalyticsReadService.listConnections` exists — the settings
 * screen's asset list is admin-gated
 * (`social.settings.integrations.manage.admin`), so an operational-tier
 * reader needs its own, strictly-narrower read under the permission that
 * already governs reading these numbers.
 *
 * Every asset in scope is returned, including revoked ones: their stored
 * history is still real, and hiding them would make that history
 * unreachable from this picker.
 */
export type SocialOrganicAnalyticsAssetView = {
  id: string;
  provider: string;
  assetType: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  status: string;
  assetTimezone: string | null;
};
