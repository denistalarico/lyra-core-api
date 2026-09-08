import { META_ORGANIC_GRAPH_API_VERSION } from '../../providers/meta/meta-organic-oauth.support';

export const META_ORGANIC_INSIGHTS_GRAPH_VERSION =
  META_ORGANIC_GRAPH_API_VERSION;

export type MetaOrganicDocumentedMetric = {
  assetType: 'facebook_page' | 'instagram_professional';
  name: string;
  endpoint: string;
  level: 'account' | 'post' | 'media';
  period: 'current_snapshot' | 'day' | 'lifetime';
  request: readonly string[];
  historical: boolean;
  /**
   * `normalized` — written as a daily-flow column.
   * `normalized_snapshot` — written as a structurally separate `*_lifetime`
   * snapshot column (A2), never merged into a flow column and never
   * summed/averaged across days.
   * `blocked_daily_grain` — a documented lifetime total this runtime still
   * refuses to write anywhere, because assigning it to a daily grain would
   * fabricate a value.
   */
  runtime: 'normalized' | 'normalized_snapshot' | 'blocked_daily_grain';
  normalizedColumn:
    | 'followersCount'
    | 'followersGained'
    | 'followersLost'
    | 'impressions'
    | 'reach'
    | 'likes'
    | 'comments'
    | 'videoViews';
  limitations: string;
  source: string;
};

/**
 * Official Meta v26 evidence matrix for every candidate counter considered by
 * A2. `blocked_daily_grain` is deliberate runtime data: it prevents a future
 * maintainer from mistaking a documented lifetime total for a daily flow.
 * `normalized_snapshot` marks the 4 lifetime counters A2 does write, into the
 * structurally separate `*_lifetime` snapshot columns — still never merged
 * into (or mistaken for) a daily-flow column.
 */
export const META_ORGANIC_DOCUMENTED_METRICS = [
  {
    assetType: 'facebook_page',
    name: 'followers_count',
    endpoint: 'GET /{page-id}',
    level: 'account',
    period: 'current_snapshot',
    request: ['fields=followers_count'],
    historical: false,
    runtime: 'normalized',
    normalizedColumn: 'followersCount',
    limitations: 'Current stock only; A2 never fabricates historical values.',
    source: 'https://developers.facebook.com/docs/graph-api/reference/page/',
  },
  {
    assetType: 'facebook_page',
    name: 'page_media_view',
    endpoint: 'GET /{page-id}/insights',
    level: 'account',
    period: 'day',
    request: [
      'metric=page_media_view',
      'period=day',
      'breakdown=is_from_ads',
      'since=<asset-local-day-start>',
      'until=<asset-local-day-end>',
    ],
    historical: true,
    runtime: 'normalized',
    normalizedColumn: 'impressions',
    limitations:
      'Includes ads unless broken down; only an explicit organic/non-ad value may be normalized.',
    source:
      'https://developers.facebook.com/docs/graph-api/reference/v26.0/insights',
  },
  {
    assetType: 'facebook_page',
    name: 'post_media_view',
    endpoint: 'GET /{page-post-id}/insights',
    level: 'post',
    period: 'lifetime',
    request: ['metric=post_media_view', 'period=lifetime'],
    historical: false,
    runtime: 'normalized_snapshot',
    normalizedColumn: 'impressions',
    limitations:
      'Lifetime cumulative total, written only into the structurally separate impressionsLifetime snapshot column — never into the A1 daily-flow impressions column, which would fabricate a daily allocation.',
    source:
      'https://developers.facebook.com/docs/graph-api/reference/v26.0/insights',
  },
  {
    assetType: 'instagram_professional',
    name: 'followers_count',
    endpoint: 'GET /{ig-user-id}',
    level: 'account',
    period: 'current_snapshot',
    request: ['fields=followers_count'],
    historical: false,
    runtime: 'normalized',
    normalizedColumn: 'followersCount',
    limitations: 'Current stock only; A2 never fabricates historical values.',
    source:
      'https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user',
  },
  {
    assetType: 'instagram_professional',
    name: 'views',
    endpoint: 'GET /{ig-user-id}/insights',
    level: 'account',
    period: 'day',
    request: [
      'metric=views',
      'period=day',
      'metric_type=total_value',
      'breakdown=media_product_type',
      'since=<asset-local-day-start>',
      'until=<asset-local-day-end>',
    ],
    historical: true,
    runtime: 'normalized',
    normalizedColumn: 'impressions',
    limitations:
      'Metric is in development; A2 excludes the documented AD breakdown.',
    source:
      'https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights',
  },
  {
    assetType: 'instagram_professional',
    name: 'reach',
    endpoint: 'GET /{ig-user-id}/insights',
    level: 'account',
    period: 'day',
    request: [
      'metric=reach',
      'period=day',
      'metric_type=total_value',
      'breakdown=media_product_type',
      'since=<asset-local-day-start>',
      'until=<asset-local-day-end>',
    ],
    historical: true,
    runtime: 'normalized',
    normalizedColumn: 'reach',
    limitations:
      'Estimated and includes ads unless broken down; A2 excludes the documented AD breakdown.',
    source:
      'https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights',
  },
  {
    assetType: 'instagram_professional',
    name: 'follows_and_unfollows',
    endpoint: 'GET /{ig-user-id}/insights',
    level: 'account',
    period: 'day',
    request: [
      'metric=follows_and_unfollows',
      'period=day',
      'metric_type=total_value',
      'breakdown=follow_type',
      'since=<asset-local-day-start>',
      'until=<asset-local-day-end>',
    ],
    historical: true,
    runtime: 'normalized',
    normalizedColumn: 'followersGained',
    limitations: 'Not returned for accounts with fewer than 100 followers.',
    source:
      'https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights',
  },
  {
    assetType: 'instagram_professional',
    name: 'follows_and_unfollows',
    endpoint: 'GET /{ig-user-id}/insights',
    level: 'account',
    period: 'day',
    request: [
      'metric=follows_and_unfollows',
      'period=day',
      'metric_type=total_value',
      'breakdown=follow_type',
      'since=<asset-local-day-start>',
      'until=<asset-local-day-end>',
    ],
    historical: true,
    runtime: 'normalized',
    normalizedColumn: 'followersLost',
    limitations: 'Not returned for accounts with fewer than 100 followers.',
    source:
      'https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights',
  },
  ...(['comments', 'likes', 'views'] as const).map((name) => ({
    assetType: 'instagram_professional' as const,
    name,
    endpoint: 'GET /{ig-media-id}/insights',
    level: 'media' as const,
    period: 'lifetime' as const,
    request: [`metric=${name}`],
    historical: false,
    runtime: 'normalized_snapshot' as const,
    normalizedColumn:
      name === 'comments'
        ? ('comments' as const)
        : name === 'likes'
          ? ('likes' as const)
          : ('videoViews' as const),
    limitations:
      'Lifetime cumulative media total, written only into the structurally separate *Lifetime snapshot column — never into the A1 daily-flow column, which would fabricate a daily allocation.',
    source:
      'https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights',
  })),
] as const satisfies readonly MetaOrganicDocumentedMetric[];

export const FACEBOOK_PAGE_ACCOUNT_METRICS = ['page_media_view'] as const;
export const INSTAGRAM_ACCOUNT_MEDIA_METRICS = ['views', 'reach'] as const;
export const INSTAGRAM_ACCOUNT_FOLLOW_METRICS = [
  'follows_and_unfollows',
] as const;

/**
 * Post-level lifetime snapshot metrics (A2 §1). Sourced from
 * `META_ORGANIC_BLOCKED_LIFETIME_METRICS` below — these are the same
 * documented counters, now written into the `*_lifetime` snapshot columns
 * rather than withheld.
 */
export const FACEBOOK_POST_LIFETIME_METRICS = ['post_media_view'] as const;
export const INSTAGRAM_MEDIA_LIFETIME_METRICS = [
  'comments',
  'likes',
  'views',
] as const;

/**
 * Documented candidates that are intentionally absent from the *daily-flow*
 * runtime. Still correct after A2 §1: these metrics are still never written
 * as a daily flow value — they are written only as `*_lifetime` snapshots,
 * via `FACEBOOK_POST_LIFETIME_METRICS`/`INSTAGRAM_MEDIA_LIFETIME_METRICS`
 * above.
 */
export const META_ORGANIC_BLOCKED_LIFETIME_METRICS = [
  'post_media_view',
  'comments',
  'likes',
  'views',
] as const;
