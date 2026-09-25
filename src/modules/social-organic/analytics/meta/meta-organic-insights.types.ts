import { META_ORGANIC_GRAPH_API_VERSION } from '../../providers/meta/meta-organic-oauth.support';
import type { SocialOrganicAudienceKind } from '../entities/social-organic-audience-daily.entity';

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
 * Account-level engagement counters, read without a breakdown.
 *
 * One request for the whole family: unlike `views`/`reach`, these take no
 * `breakdown`, so Meta returns each as a bare `total_value.value` and they can
 * share a call. Only `profile_views` has a column today — the rest are stored in
 * `provider_metrics` until columns exist for them, so that the request that
 * would have to be repeated to backfill them is made once.
 *
 * Verified against production on 2026-09-22; `content_views` answers with an
 * empty `data` array and `threads_views` is rejected outright, so neither is
 * requested here.
 */
export const INSTAGRAM_ACCOUNT_ENGAGEMENT_METRICS = [
  'profile_views',
  'accounts_engaged',
  'total_interactions',
  'likes',
  'comments',
  'shares',
  'saves',
  'replies',
] as const;

/**
 * Post-level lifetime snapshot metrics (A2 §1). Sourced from
 * `META_ORGANIC_BLOCKED_LIFETIME_METRICS` below — these are the same
 * documented counters, now written into the `*_lifetime` snapshot columns
 * rather than withheld.
 */
export const FACEBOOK_POST_LIFETIME_METRICS = ['post_media_view'] as const;

/**
 * The counters every Instagram surface answers, whatever it is.
 *
 * Verified against production on 2026-09-24 at `/{ig-media-id}/insights` for a
 * feed post and a reel. These are the ones a ranking can order by across
 * surfaces, because they mean the same thing on each.
 */
const INSTAGRAM_MEDIA_SHARED_METRICS = [
  'comments',
  'likes',
  'views',
  'reach',
  'saved',
  'shares',
  'total_interactions',
] as const;

/**
 * The lifetime metrics for a feed post.
 *
 * `profile_visits` and `follows` answer a question nothing else does — how many
 * accounts this post sent to the profile, and how many it won — and the feed is
 * the only surface that reports them.
 */
export const INSTAGRAM_MEDIA_LIFETIME_METRICS = [
  ...INSTAGRAM_MEDIA_SHARED_METRICS,
  'profile_visits',
  'follows',
] as const;

/**
 * The lifetime metrics for a reel, which are not the feed's.
 *
 * ## Why this list has to exist
 *
 * Meta rejects the *whole request* when one metric does not apply to the
 * media's product type: asking a reel for `profile_visits, follows` returns
 * `(#100) The Media Insights API does not support the profile_visits, follows
 * metric for this media product type` and nothing else. It is not a partial
 * answer with the unsupported fields missing — the supported seven come back
 * too, so one inapplicable name costs the entire read.
 *
 * That is exactly what was happening: the sync sent
 * `INSTAGRAM_MEDIA_LIFETIME_METRICS` to every discovered post, so every reel's
 * call failed and no reel ever produced a row. Verified on 2026-09-24 against
 * an account with 65 reels and 313 feed posts, whose fact table held three feed
 * posts and no reels at all. The symptom looked like "the account has no
 * reels", which is why it survived: an empty table is indistinguishable from an
 * account that does not post reels.
 *
 * `reels_skip_rate` is a **percentage**, not a counter — it is stored scaled
 * rather than in a `bigint` counter column, for the reason the entity
 * documents. The two watch-time metrics are **milliseconds**.
 */
export const INSTAGRAM_REEL_LIFETIME_METRICS = [
  ...INSTAGRAM_MEDIA_SHARED_METRICS,
  'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time',
  'reels_skip_rate',
  'reposts',
] as const;

/**
 * The lifetime metrics for a story.
 *
 * `navigation` is the one that carries the retention columns — "Avançar",
 * "Próximo story", "Voltar" and "Sair" — as a breakdown by
 * `story_navigation_action_type`, which is why it is read in its own request
 * rather than joined here.
 *
 * Unverifiable against the production account: it has never had a story while
 * one was being observed, and a story cannot be read after it expires. Both
 * names come from Meta's Media Insights reference and its refusal message,
 * which listed `replies` and `navigation` among the valid metrics for *some*
 * product type while rejecting them for feed and reel — the two surfaces that
 * account has. So the list is documented, not measured, and the collector
 * treats a refusal as an absent metric rather than a failed sync.
 */
export const INSTAGRAM_STORY_LIFETIME_METRICS = [
  'reach',
  'views',
  'replies',
  'shares',
  'total_interactions',
  'profile_visits',
  'follows',
] as const;

/**
 * The metric whose breakdown gives a story's retention.
 *
 * Read separately from `INSTAGRAM_STORY_LIFETIME_METRICS` because it needs
 * `breakdown=story_navigation_action_type` and `metric_type=total_value`, which
 * the plain lifetime read does not take.
 */
export const INSTAGRAM_STORY_NAVIGATION_METRIC = 'navigation';

/**
 * The Instagram lifetime metric list for a `media_product_type`.
 *
 * Unknown spellings get the feed list: it is the conservative choice for the
 * surface Meta most often means by an unfamiliar name, and a wrong guess costs
 * one refused call for one post rather than a silent gap.
 */
export function instagramMediaLifetimeMetrics(
  mediaProductType: string | null,
): readonly string[] {
  const surface = (mediaProductType ?? '').toUpperCase();

  if (surface === 'REEL' || surface === 'REELS') {
    return INSTAGRAM_REEL_LIFETIME_METRICS;
  }
  if (surface === 'STORY' || surface === 'STORIES') {
    return INSTAGRAM_STORY_LIFETIME_METRICS;
  }
  return INSTAGRAM_MEDIA_LIFETIME_METRICS;
}

/**
 * The audience-demographics metric each asset type exposes.
 *
 * Instagram only, as of Graph v26. It reports `follower_demographics` as a
 * `total_value` metric taking one `breakdown` at a time. A Facebook Page used to
 * report `page_fans_gender_age` and `page_fans_city` as lifetime metrics whose
 * value was already a bucket map — a shape different enough that the reader has
 * one normalizer per provider rather than one with a flag — but Meta has since
 * retired those metrics entirely; see `FACEBOOK_AUDIENCE_METRICS_RETIRED`.
 *
 * Every one of these is a **lifetime stock**, never a daily flow. They are
 * written only to `social_organic_audience_daily`, whose whole contract is that
 * its values are never summed across days — the same rule the `*_lifetime`
 * snapshot columns already enforce on the post table, made structural by living
 * in a table that has no flow column at all.
 */
export const INSTAGRAM_AUDIENCE_METRIC = 'follower_demographics';

/**
 * The dimensions asked of `follower_demographics`, one request each.
 *
 * ## The cross is real, and is asked for rather than derived
 *
 * `age,gender` is a single breakdown Meta accepts, verified against production
 * on 2026-09-24: it answers with `dimension_keys: ["age","gender"]` and one
 * result per cell (`["25-34","F"] → 110`). An earlier version of this comment
 * said the cross was not on offer and that only marginals were available; that
 * was wrong, and the marginals-only reading is what left the audience chart
 * unable to show the breakdown an operator actually asks for.
 *
 * The marginals are still requested alongside it. They are not redundant: Meta
 * suppresses small buckets independently in each response, so the cross does
 * not sum to either marginal — on the production account the `age` marginal
 * totals 1 058 while the cross totals less. Each is the best answer to its own
 * question, and deriving one from the other would be arithmetic on suppressed
 * data.
 */
export const INSTAGRAM_AUDIENCE_BREAKDOWNS = [
  'age',
  'gender',
  // Comma-joined in one parameter, which is how Meta spells a cross. Not two
  // dimensions in two calls.
  'age,gender',
  'city',
  'country',
] as const;

/**
 * The stored `breakdown_kind` for each requested breakdown.
 *
 * Only the cross needs translating: Meta's parameter is `age,gender` and the
 * column's value is `age_gender`, which the entity's type has always declared
 * and which rows collected from the (now retired) Facebook side already use.
 * Storing the provider's spelling instead would split one audience into two
 * kinds that no chart joins back together.
 */
export const INSTAGRAM_AUDIENCE_BREAKDOWN_KINDS: Record<
  (typeof INSTAGRAM_AUDIENCE_BREAKDOWNS)[number],
  SocialOrganicAudienceKind
> = {
  age: 'age',
  gender: 'gender',
  'age,gender': 'age_gender',
  city: 'city',
  country: 'country',
};

/**
 * The Page metrics that used to carry the same information. **Retired by Meta.**
 *
 * `page_fans_gender_age`, `page_fans_city` and `page_fans_country` answer
 * `(#100) The value must be a valid insights metric` — the byte-identical error
 * an invented metric name gets, while `page_follows` succeeds in the same call
 * against the same Page with the same token. v23 and v20 refuse it too, so this
 * is a retirement across the API rather than a version to pin back to.
 * Verified against production on 2026-09-22.
 *
 * Kept as documentation rather than deleted: the names are what a maintainer
 * will search for when asked why the Facebook audience tab is empty, and the
 * `age_gender` spelling still exists in `SocialOrganicAudienceKind` for rows
 * collected before the retirement. Nothing requests these — see the
 * `facebook_page` branch of `MetaOrganicAudienceService`.
 */
export const FACEBOOK_AUDIENCE_METRICS_RETIRED = [
  { metric: 'page_fans_gender_age', kind: 'age_gender' },
  { metric: 'page_fans_city', kind: 'city' },
  { metric: 'page_fans_country', kind: 'country' },
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
