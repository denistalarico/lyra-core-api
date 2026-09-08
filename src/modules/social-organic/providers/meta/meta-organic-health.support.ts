/**
 * `MA4` support: everything about *what counts as healthy* for a Meta
 * organic asset, kept out of the service so the classification rules can be
 * unit tested as plain data/functions.
 */

export type MetaOrganicHealthStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Stable, provider-agnostic vocabulary. Never a raw Meta error code/message.
 * `last_health_status` (varchar(64)) only ever stores one of
 * `MetaOrganicHealthStatus` above; this is the richer reason surfaced by the
 * on-demand endpoint and safe logs, never persisted verbatim to the DB.
 */
export type MetaOrganicHealthReason =
  | 'ok'
  | 'expires_soon'
  | 'credential_expired'
  | 'credential_removed'
  | 'permission_lost'
  | 'asset_unreachable'
  | 'connection_disconnected'
  | 'provider_unavailable'
  | 'unknown';

/**
 * Required *publishing* scopes per Meta asset type — the subset of
 * `SOCIAL_META_ORGANIC_SCOPES` (`MA1.1`) that blueprint §17 actually cites
 * for that asset type's publish calls. Not every one of the six persisted
 * scopes applies to every asset type:
 *
 * - `facebook_page`: `pages_manage_posts` is cited on every Facebook Page
 *   publish placement (text/photo/Stories/Reels) in blueprint §17.1, always
 *   alongside `pages_read_engagement` and `pages_show_list`.
 * - `instagram_professional`: blueprint §17.2's Image-post row and App
 *   Review row both cite exactly `instagram_basic`, `instagram_content_publish`,
 *   `pages_read_engagement` for the Facebook-Login-for-Business path this app
 *   uses. `pages_show_list` is explicitly flagged in that same row as
 *   "inconsistent across the fetched pages" — left out here rather than
 *   guessed in.
 *
 * `business_management` is deliberately absent from both lists: every §17
 * citation is for a publish call, and none cites it. It is MA1's Business
 * Manager *discovery* scope, not a per-asset publish requirement — asserting
 * it here would fail assets closed for a scope that Meta's own publish docs
 * never mention needing.
 */
export const META_REQUIRED_PUBLISHING_SCOPES: Readonly<
  Record<string, readonly string[]>
> = {
  facebook_page: [
    'pages_manage_posts',
    'pages_read_engagement',
    'pages_show_list',
  ],
  instagram_professional: [
    'instagram_basic',
    'instagram_content_publish',
    'pages_read_engagement',
  ],
};

export function requiredPublishingScopes(
  assetType: string,
): readonly string[] | null {
  return META_REQUIRED_PUBLISHING_SCOPES[assetType] ?? null;
}

/**
 * How close to expiry counts as `degraded` rather than `healthy`.
 *
 * No existing health/sync precedent in this codebase defines a "near expiry"
 * window (`SocialOrganicCredentialResolver`'s `TOKEN_EXPIRY_SKEW_MS` is a
 * 60-second hard-refuse skew for a token already being used, not a
 * look-ahead warning). Seven days is chosen because it comfortably exceeds
 * this scheduler's own check cadence (hourly — see
 * `social-organic-health.scheduler.ts`), so an expiring token is flagged
 * `degraded` on multiple passes before it actually lapses into `unhealthy`,
 * giving an operator a real window to reconnect rather than a single
 * same-hour warning.
 */
export const HEALTH_NEAR_EXPIRY_MS = 7 * 24 * 60 * 60_000;
