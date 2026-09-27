import type {
  NormalizedOrganicAccountMetricDaily,
  NormalizedOrganicPostMetricDaily,
} from '../social-organic-insights.contract';
import {
  calendarDayIn,
  shiftCalendarDay,
} from '../social-organic-analytics-time';
import {
  FACEBOOK_REACTION_TYPES,
  type FacebookReactionType,
} from './meta-organic-insights.types';

/** One day of the Page series, as the backfill writes it. */
export type PageSeriesDay = {
  pageFollows: string | null;
  pageDailyFollows: string | null;
  pageDailyUnfollows: string | null;
  newConversations: string | null;
};

/**
 * A multi-day Page series response, indexed by the calendar day it describes.
 *
 * ## `end_time` is not the day
 *
 * Meta stamps each entry with the **end** of the period it covers, which is
 * midnight at the start of the *next* day: the entry for Monday arrives as
 * `2026-09-22T07:00:00+0000` when the Page is in São Paulo. Filing it under the
 * day that timestamp falls on would shift the entire series forward by one, so
 * every figure would be attributed to the day after the one it happened on —
 * a bug that produces a perfectly plausible chart.
 *
 * So the timestamp is converted to a calendar day in the asset's zone and then
 * shifted back one. The zone matters as much as the shift: the same instant is
 * a different date in two zones, and a Page in São Paulo whose days were filed
 * in UTC would be off by one for every post-21:00 reading.
 */
export function readPageSeriesByDate(
  payload: unknown,
  timezone: string,
): Map<string, PageSeriesDay> {
  const metrics = readMetrics(payload);
  const byDate = new Map<string, PageSeriesDay>();

  const collect = (metricName: string, field: keyof PageSeriesDay): void => {
    const metric = metrics.get(metricName);
    if (!metric) return;

    const values: unknown = metric.values;
    if (!Array.isArray(values)) return;

    for (const entry of values as unknown[]) {
      if (!isRecord(entry) || typeof entry.end_time !== 'string') continue;

      const endsAt = new Date(entry.end_time);
      if (Number.isNaN(endsAt.getTime())) continue;

      const day = shiftCalendarDay(calendarDayIn(timezone, endsAt), -1);
      const counter = readOptionalCounter(entry.value);
      if (counter === null) continue;

      const existing = byDate.get(day) ?? {
        pageFollows: null,
        pageDailyFollows: null,
        pageDailyUnfollows: null,
        newConversations: null,
      };

      byDate.set(day, { ...existing, [field]: counter });
    }
  };

  collect('page_follows', 'pageFollows');
  collect('page_daily_follows_unique', 'pageDailyFollows');
  collect('page_daily_unfollows_unique', 'pageDailyUnfollows');
  collect('page_messages_new_conversations_unique', 'newConversations');

  return byDate;
}

type NormalizeBase = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  provider: string;
  assetTimezone: string;
  metricDate: string;
  currentDay: string;
  syncedAt: Date;
  syncRunId: string;
};

export class MetaOrganicInsightsNormalizationError extends Error {
  readonly code = 'meta_invalid_response';

  constructor() {
    super('meta_invalid_response');
    this.name = 'MetaOrganicInsightsNormalizationError';
  }
}

export function normalizeFacebookAccountInsights(
  input: NormalizeBase & {
    followersCount: unknown;
    insights: unknown;
    /**
     * The Page's daily series read, optional.
     *
     * Optional for the reason the Instagram engagement read is: a caller that
     * predates it, or a stored payload replayed from before it existed, still
     * normalizes with these fields null rather than throwing.
     */
    seriesInsights?: unknown;
  },
): NormalizedOrganicAccountMetricDaily | null {
  const metrics = readMetrics(input.insights);
  const series =
    input.seriesInsights === undefined
      ? null
      : readMetrics(input.seriesInsights);
  const followersCount =
    input.metricDate === input.currentDay
      ? readOptionalCounter(input.followersCount)
      : null;
  const impressions = readOrganicBreakdown(metrics.get('page_media_view'));
  // The same response the organic figure comes from, read for both halves.
  // The paid half was always in the payload and was being discarded.
  const viewSplit = readAdsBreakdown(metrics.get('page_media_view'));
  // `page_follows` is the day's own follower level. Unlike `followersCount`
  // above it is not gated on `currentDay`: that gate exists because the profile
  // field only knows "now", which is exactly the limitation this metric does
  // not have.
  const pageFollows = readDaySeriesValue(series?.get('page_follows'));
  const pageDailyFollows = readDaySeriesValue(
    series?.get('page_daily_follows_unique'),
  );
  const pageDailyUnfollows = readDaySeriesValue(
    series?.get('page_daily_unfollows_unique'),
  );
  const newConversations = readDaySeriesValue(
    series?.get('page_messages_new_conversations_unique'),
  );

  if (
    followersCount === null &&
    impressions === null &&
    pageFollows === null &&
    pageDailyFollows === null &&
    pageDailyUnfollows === null &&
    newConversations === null
  ) {
    return null;
  }

  return accountFact(input, {
    followersCount,
    impressions,
    pageFollows,
    pageDailyFollows,
    pageDailyUnfollows,
    viewsOrganic: viewSplit.organic,
    viewsPaid: viewSplit.paid,
    newConversations,
    providerMetrics: withSnapshot(
      { ...metrics.providerMetrics, ...(series?.providerMetrics ?? {}) },
      {
        followers_count:
          input.metricDate === input.currentDay
            ? jsonValue(input.followersCount)
            : undefined,
      },
    ),
  });
}

export function normalizeInstagramAccountInsights(
  input: NormalizeBase & {
    followersCount: unknown;
    mediaInsights: unknown;
    followInsights: unknown;
    /**
     * The account engagement read, optional.
     *
     * Optional rather than required so that a caller which has not been updated
     * — or a stored payload replayed from before this read existed — still
     * normalizes, with the engagement fields null instead of throwing.
     */
    engagementInsights?: unknown;
  },
): NormalizedOrganicAccountMetricDaily | null {
  const media = readMetrics(input.mediaInsights);
  const follows = readMetrics(input.followInsights);
  const engagement =
    input.engagementInsights === undefined
      ? null
      : readMetrics(input.engagementInsights);
  const followersCount =
    input.metricDate === input.currentDay
      ? readOptionalCounter(input.followersCount)
      : null;
  const impressions = readNonAdMediaProducts(media.get('views'));
  const reach = readNonAdMediaProducts(media.get('reach'));
  // The same two responses read a second way: `total_value.value` is the
  // account's total with ads included, which the breakdown sum above
  // deliberately excludes. Both numbers come from one request — the total was
  // always in the payload and simply had nowhere to go until migration
  // 1796000000000, which also backfilled it from `provider_metrics`.
  //
  // Not derived from each other in either direction. Meta de-duplicates the
  // total independently, so an account reached organically and by an ad is
  // counted once in the total and once in each slice; the slices do not add up
  // to it, and subtracting one from the other would state a figure Meta never
  // reported.
  const viewsTotal = readPlainTotal(media.get('views'));
  const reachTotal = readPlainTotal(media.get('reach'));
  const followMetric = follows.get('follows_and_unfollows');
  const followersGained = readBreakdownDimension(followMetric, 'FOLLOWER');
  const followersLost = readBreakdownDimension(followMetric, 'NON_FOLLOWER');
  // A plain `total_value.value`, with no breakdown to unpack — which is why it
  // reads through `readPlainTotal` rather than either breakdown helper. The
  // column already existed and was never populated for Instagram; the Page side
  // has no equivalent metric on v26.
  const profileViews = readPlainTotal(engagement?.get('profile_views'));
  // The rest of the engagement family, read the same way and from the same
  // response. They were already being requested and already being stored whole
  // in `provider_metrics`; migration 1795600000000 gave them columns and
  // backfilled the history from that JSONB.
  const totalInteractions = readPlainTotal(
    engagement?.get('total_interactions'),
  );
  const accountsEngaged = readPlainTotal(engagement?.get('accounts_engaged'));
  const likes = readPlainTotal(engagement?.get('likes'));
  const comments = readPlainTotal(engagement?.get('comments'));
  const shares = readPlainTotal(engagement?.get('shares'));
  const saves = readPlainTotal(engagement?.get('saves'));
  const replies = readPlainTotal(engagement?.get('replies'));

  if (
    followersCount === null &&
    impressions === null &&
    reach === null &&
    viewsTotal === null &&
    reachTotal === null &&
    followersGained === null &&
    followersLost === null &&
    profileViews === null &&
    totalInteractions === null &&
    accountsEngaged === null &&
    likes === null &&
    comments === null &&
    shares === null &&
    saves === null &&
    replies === null
  ) {
    return null;
  }

  return accountFact(input, {
    followersCount,
    followersGained,
    followersLost,
    impressions,
    reach,
    viewsTotal,
    reachTotal,
    profileViews,
    totalInteractions,
    accountsEngaged,
    likes,
    comments,
    shares,
    saves,
    replies,
    providerMetrics: withSnapshot(
      {
        ...media.providerMetrics,
        ...follows.providerMetrics,
        ...(engagement?.providerMetrics ?? {}),
      },
      {
        followers_count:
          input.metricDate === input.currentDay
            ? jsonValue(input.followersCount)
            : undefined,
      },
    ),
  });
}

type PostLifetimeBase = NormalizeBase & {
  externalPublicationId: string;
  publicationId: string | null;
  observedAt: Date;
  /**
   * Who the post is, carried from discovery rather than measured.
   *
   * Optional so a caller that only has ids still normalizes. The image URL is
   * absent on purpose — Meta signs it with a ~5 day expiry, so it is resolved
   * on demand and never stored.
   */
  permalink?: string | null;
  caption?: string | null;
  mediaType?: string | null;
  mediaProductType?: string | null;
  publishedAt?: Date | null;
};

/**
 * FB Page-post lifetime snapshot (A2 §1). `post_media_view` is documented
 * only as `period=lifetime` — a cumulative total, not a daily flow — so it is
 * written only into `impressionsLifetime`/`impressionsLifetimeObservedAt`,
 * never into the flow `impressions` column. `metricDate` is always the sync's
 * `currentDay` (the day of observation), never the post's publish day and
 * never iterated per day: a lifetime total's meaning is "as observed now",
 * and stamping it against a historical day would misrepresent when Lyra
 * actually saw that value.
 */
export function normalizeFacebookPostLifetimeSnapshot(
  input: PostLifetimeBase & {
    insights: unknown;
    /**
     * The reaction map, from a request of its own.
     *
     * Separate because `post_reactions_by_type_total` does not accept the
     * `is_from_ads` breakdown that `post_media_view` is read with, and Meta
     * refuses the whole request rather than the one metric — see
     * `FACEBOOK_POST_REACTION_METRICS`. Optional, so a refusal costs six
     * columns rather than the row.
     */
    reactionInsights?: unknown;
    /**
     * `shares`, `comments` and `reactions` read as post *fields*.
     *
     * Optional because they come from a second call that is allowed to fail:
     * the insights are the measurement, and losing the engagement fields should
     * cost those three columns rather than the whole row.
     */
    engagementFields?: unknown;
  },
): NormalizedOrganicPostMetricDaily | null {
  const metrics = readMetrics(input.insights);
  const impressionsLifetime = readLifetimeCounter(
    metrics.get('post_media_view'),
  );
  const reactionMetrics =
    input.reactionInsights === undefined
      ? null
      : readMetrics(input.reactionInsights);
  const reactions = readReactionMap(
    reactionMetrics?.get('post_reactions_by_type_total'),
  );
  // Read a second way from the same response: the `is_from_ads` breakdown puts
  // both buckets in the payload that already carried the total, so the split
  // costs no extra call. Meta's own buckets, never `total - organic`.
  const viewSplit = readAdsBreakdown(metrics.get('post_media_view'));
  const fields = readPostEngagementFields(input.engagementFields);

  // The row is worth writing if *anything* was measured. Keyed on the whole set
  // rather than on impressions alone, because a post with reactions and no
  // recorded views is a real post and dropping it would leave a gap in the
  // ranking that looks like the post never existed.
  if (
    impressionsLifetime === null &&
    reactions === null &&
    fields.commentsTotal === null &&
    fields.sharesTotal === null &&
    fields.reactionsTotal === null
  ) {
    return null;
  }

  return postLifetimeFact(input, {
    impressionsLifetime,
    impressionsLifetimeObservedAt:
      impressionsLifetime === null ? null : input.observedAt,
    viewsOrganicLifetime: viewSplit.organic,
    viewsPaidLifetime: viewSplit.paid,
    // The summary total wins over the map's sum when both exist: Meta counts
    // the summary as of now while the insights map is a lifetime figure that
    // still includes reactions since removed, and the operator's "total de
    // reações" is the number their own Page dashboard shows.
    reactionsTotal: fields.reactionsTotal ?? reactions?.total ?? null,
    reactionsLike: reactions?.like ?? null,
    reactionsLove: reactions?.love ?? null,
    reactionsWow: reactions?.wow ?? null,
    reactionsHaha: reactions?.haha ?? null,
    reactionsSorry: reactions?.sorry ?? null,
    reactionsAnger: reactions?.anger ?? null,
    commentsLifetime: fields.commentsTotal,
    commentsLifetimeObservedAt:
      fields.commentsTotal === null ? null : input.observedAt,
    sharesLifetime: fields.sharesTotal,
    lifetimeObservedAt: input.observedAt,
    // Both responses' leftovers. The reaction read is a separate request, so
    // anything Meta returned there that has no column would be dropped if only
    // the first response's bag were kept.
    providerMetrics: {
      ...metrics.providerMetrics,
      ...(reactionMetrics?.providerMetrics ?? {}),
    },
  });
}

/**
 * `post_reactions_by_type_total` — a map, not a counter.
 *
 * Meta answers `{"like": 1, "love": 3}`, omitting every type with no
 * reactions, and `{}` for a post nobody reacted to. An empty map is a real
 * measurement of zero and is reported as zeros rather than nulls; a missing
 * metric is null, because "nobody reacted" and "not measured" are different
 * claims and the table prints them differently.
 *
 * An unrecognised key is dropped rather than added to the total. Meta's six
 * types have been fixed since 2016, so an unknown one is more likely a new
 * reaction with no column than a value belonging in an existing bucket, and a
 * wrong bucket looks like a measurement while an absent one does not.
 */
function readReactionMap(
  metric: MetricEntry | undefined,
): (Record<FacebookReactionType, string> & { total: string }) | null {
  if (!metric) return null;

  const value = rawMetricValue(metric);
  if (!isRecord(value)) return null;

  const counts = {} as Record<FacebookReactionType, string>;
  let total = 0n;

  for (const type of FACEBOOK_REACTION_TYPES) {
    const raw: unknown = hasOwn(value, type) ? value[type] : 0;
    const counter = readOptionalCounter(raw) ?? '0';
    counts[type] = counter;
    total += BigInt(counter);
  }

  return { ...counts, total: String(total) };
}

/**
 * The `is_from_ads` buckets of a post metric.
 *
 * Meta spells them `"0"` and `"1"` as strings on the value entries. Unlike
 * Instagram's `media_product_type` slices, these two *do* partition the total:
 * a view was either served by an ad or it was not, and Meta does no
 * de-duplication across them.
 */
function readAdsBreakdown(metric: MetricEntry | undefined): {
  organic: string | null;
  paid: string | null;
} {
  const blank = { organic: null, paid: null };
  if (!metric) return blank;

  const values: unknown = metric.values;
  if (!Array.isArray(values)) return blank;

  let organic: string | null = null;
  let paid: string | null = null;

  for (const entry of values as unknown[]) {
    if (!isRecord(entry) || !hasOwn(entry, 'is_from_ads')) continue;

    const counter = readOptionalCounter(entry.value);
    if (counter === null) continue;

    if (entry.is_from_ads === '0' || entry.is_from_ads === 0) organic = counter;
    if (entry.is_from_ads === '1' || entry.is_from_ads === 1) paid = counter;
  }

  return { organic, paid };
}

/**
 * `shares.count`, `comments.summary.total_count`, `reactions.summary.*`.
 *
 * Three different shapes in one payload, because Meta never settled on one:
 * shares is a bare object with a `count`, while comments and reactions are
 * edges carrying a `summary`. All three are absent rather than zero on a post
 * that has none of that kind, which is why each is read independently.
 */
function readPostEngagementFields(payload: unknown): {
  sharesTotal: string | null;
  commentsTotal: string | null;
  reactionsTotal: string | null;
} {
  const blank = {
    sharesTotal: null,
    commentsTotal: null,
    reactionsTotal: null,
  };
  if (!isRecord(payload)) return blank;

  const summaryCount = (key: string): string | null => {
    const edge: unknown = hasOwn(payload, key) ? payload[key] : null;
    if (!isRecord(edge) || !isRecord(edge.summary)) return null;
    return readOptionalCounter(edge.summary.total_count);
  };

  const shares: unknown = hasOwn(payload, 'shares') ? payload.shares : null;

  return {
    sharesTotal: isRecord(shares) ? readOptionalCounter(shares.count) : null,
    commentsTotal: summaryCount('comments'),
    reactionsTotal: summaryCount('reactions'),
  };
}

/**
 * IG media lifetime snapshot (A2 §1). One batched call for `comments`,
 * `likes` and `views` — all three are documented only as `period=lifetime`.
 * Returns whichever subset of the three is actually present in the response
 * (not all-or-nothing): a partial IG response still carries real evidence for
 * the metrics it does report. Only returns `null` if all three are absent.
 *
 * One function for every surface, because it reads by metric name and the
 * caller chooses which names to ask for. A feed post's response simply has no
 * `ig_reels_avg_watch_time` in it, and a reel's has no `profile_visits`; both
 * come back null through the same path, with no branch to keep in step.
 */
export function normalizeInstagramMediaLifetimeSnapshot(
  input: PostLifetimeBase & { insights: unknown },
): NormalizedOrganicPostMetricDaily | null {
  const metrics = readMetrics(input.insights);
  const commentsLifetime = readLifetimeCounter(metrics.get('comments'));
  const likesLifetime = readLifetimeCounter(metrics.get('likes'));
  const videoViewsLifetime = readLifetimeCounter(metrics.get('views'));
  // The ranking counters, read from the same response. All lifetime totals, so
  // they land in `*_lifetime` columns and share one observation instant.
  const reachLifetime = readLifetimeCounter(metrics.get('reach'));
  const savesLifetime = readLifetimeCounter(metrics.get('saved'));
  const sharesLifetime = readLifetimeCounter(metrics.get('shares'));
  const totalInteractionsLifetime = readLifetimeCounter(
    metrics.get('total_interactions'),
  );
  const profileVisitsLifetime = readLifetimeCounter(
    metrics.get('profile_visits'),
  );
  const followsLifetime = readLifetimeCounter(metrics.get('follows'));
  // Reel-only, and absent from a feed post's response rather than zero there.
  const reelsAvgWatchTimeMs = readLifetimeCounter(
    metrics.get('ig_reels_avg_watch_time'),
  );
  const reelsTotalWatchTimeMs = readLifetimeCounter(
    metrics.get('ig_reels_video_view_total_time'),
  );
  const repostsLifetime = readLifetimeCounter(metrics.get('reposts'));
  const reelsSkipRateBp = readRateAsBasisPoints(metrics.get('reels_skip_rate'));

  const ranking = [
    reachLifetime,
    savesLifetime,
    sharesLifetime,
    totalInteractionsLifetime,
    profileVisitsLifetime,
    followsLifetime,
  ];

  if (
    commentsLifetime === null &&
    likesLifetime === null &&
    videoViewsLifetime === null &&
    ranking.every((value) => value === null) &&
    // A reel whose only readable numbers are its watch times is still a reel
    // worth a row: dropping it would leave the table saying the account
    // published nothing that day.
    reelsAvgWatchTimeMs === null &&
    reelsTotalWatchTimeMs === null &&
    reelsSkipRateBp === null &&
    repostsLifetime === null
  ) {
    return null;
  }

  return postLifetimeFact(input, {
    commentsLifetime,
    commentsLifetimeObservedAt:
      commentsLifetime !== null ? input.observedAt : null,
    likesLifetime,
    likesLifetimeObservedAt: likesLifetime !== null ? input.observedAt : null,
    videoViewsLifetime,
    videoViewsLifetimeObservedAt:
      videoViewsLifetime !== null ? input.observedAt : null,
    reachLifetime,
    savesLifetime,
    sharesLifetime,
    totalInteractionsLifetime,
    profileVisitsLifetime,
    followsLifetime,
    reelsAvgWatchTimeMs,
    reelsTotalWatchTimeMs,
    reelsSkipRateBp,
    repostsLifetime,
    // Stamped only when at least one of them was actually read, so the column
    // never claims an observation that produced nothing.
    lifetimeObservedAt: ranking.some((value) => value !== null)
      ? input.observedAt
      : null,
    providerMetrics: metrics.providerMetrics,
  });
}

/**
 * A percentage metric as basis points: `66.1` becomes `"6610"`.
 *
 * `reels_skip_rate` is the only metric on this endpoint that is a rate rather
 * than a count, and the fact table deliberately stores no ratios as ratios —
 * see the column's docblock. Scaling here rather than at the writer keeps the
 * one place that knows Meta's unit next to the one that knows the metric name.
 *
 * Rounded, not truncated: at two decimal places of a percentage the difference
 * is a hundredth of a point, and rounding is the one that does not always
 * understate.
 */
function readRateAsBasisPoints(metric: MetricEntry | undefined): string | null {
  if (!metric) return null;

  const raw = rawMetricValue(metric);

  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  // Outside 0-100 it is not a small error, it is a different unit or a parsing
  // failure, and the check constraint would refuse it at the writer anyway.
  if (raw < 0 || raw > 100) return null;

  return String(Math.round(raw * 100));
}

/** A lifetime metric's raw scalar value, wherever this endpoint places it. */
function readLifetimeCounter(metric: MetricEntry | undefined): string | null {
  if (!metric) return null;
  const value = rawMetricValue(metric);
  return value === null ? null : readRequiredCounter(value);
}

function postLifetimeFact(
  input: PostLifetimeBase,
  values: Partial<
    Pick<
      NormalizedOrganicPostMetricDaily,
      | 'impressionsLifetime'
      | 'impressionsLifetimeObservedAt'
      | 'likesLifetime'
      | 'likesLifetimeObservedAt'
      | 'commentsLifetime'
      | 'commentsLifetimeObservedAt'
      | 'videoViewsLifetime'
      | 'videoViewsLifetimeObservedAt'
      | 'reachLifetime'
      | 'savesLifetime'
      | 'sharesLifetime'
      | 'totalInteractionsLifetime'
      | 'profileVisitsLifetime'
      | 'followsLifetime'
      | 'lifetimeObservedAt'
      | 'reelsAvgWatchTimeMs'
      | 'reelsTotalWatchTimeMs'
      | 'reelsSkipRateBp'
      | 'repostsLifetime'
      | 'reactionsTotal'
      | 'reactionsLike'
      | 'reactionsLove'
      | 'reactionsWow'
      | 'reactionsHaha'
      | 'reactionsSorry'
      | 'reactionsAnger'
      | 'viewsOrganicLifetime'
      | 'viewsPaidLifetime'
    >
  > & { providerMetrics: Record<string, unknown> },
): NormalizedOrganicPostMetricDaily {
  return {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agencyClientId: input.agencyClientId,
    assetId: input.assetId,
    provider: input.provider,
    source: 'organic',
    externalPublicationId: input.externalPublicationId,
    publicationId: input.publicationId,
    // Always the day of observation, never the post's publish day, and never
    // iterated per day — see the docblocks above.
    metricDate: input.metricDate,
    assetTimezone: input.assetTimezone,
    impressions: null,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    videoViews: null,
    watchTimeSeconds: null,
    linkClicks: null,
    profileVisits: null,
    reachLifetime: values.reachLifetime ?? null,
    savesLifetime: values.savesLifetime ?? null,
    sharesLifetime: values.sharesLifetime ?? null,
    totalInteractionsLifetime: values.totalInteractionsLifetime ?? null,
    profileVisitsLifetime: values.profileVisitsLifetime ?? null,
    followsLifetime: values.followsLifetime ?? null,
    lifetimeObservedAt: values.lifetimeObservedAt ?? null,
    // Identity, not measurement: these describe which post the row is about,
    // and they come from discovery rather than from the insights read — which
    // is why they are taken from `input` and not from `values`. `permalink`
    // rather than the image URL, which Meta signs with a ~5 day expiry.
    permalink: input.permalink ?? null,
    caption: input.caption ?? null,
    mediaType: input.mediaType ?? null,
    mediaProductType: input.mediaProductType ?? null,
    publishedAt: input.publishedAt ?? null,
    impressionsLifetime: values.impressionsLifetime ?? null,
    impressionsLifetimeObservedAt: values.impressionsLifetimeObservedAt ?? null,
    likesLifetime: values.likesLifetime ?? null,
    likesLifetimeObservedAt: values.likesLifetimeObservedAt ?? null,
    commentsLifetime: values.commentsLifetime ?? null,
    commentsLifetimeObservedAt: values.commentsLifetimeObservedAt ?? null,
    videoViewsLifetime: values.videoViewsLifetime ?? null,
    videoViewsLifetimeObservedAt: values.videoViewsLifetimeObservedAt ?? null,
    reelsAvgWatchTimeMs: values.reelsAvgWatchTimeMs ?? null,
    reelsTotalWatchTimeMs: values.reelsTotalWatchTimeMs ?? null,
    reelsSkipRateBp: values.reelsSkipRateBp ?? null,
    repostsLifetime: values.repostsLifetime ?? null,
    // Facebook only; null on every Instagram row, where the metric does not
    // exist rather than measuring zero.
    reactionsTotal: values.reactionsTotal ?? null,
    reactionsLike: values.reactionsLike ?? null,
    reactionsLove: values.reactionsLove ?? null,
    reactionsWow: values.reactionsWow ?? null,
    reactionsHaha: values.reactionsHaha ?? null,
    reactionsSorry: values.reactionsSorry ?? null,
    reactionsAnger: values.reactionsAnger ?? null,
    viewsOrganicLifetime: values.viewsOrganicLifetime ?? null,
    viewsPaidLifetime: values.viewsPaidLifetime ?? null,
    // A lifetime read is complete-as-of-observation by definition, unlike a
    // same-day flow row that is still accumulating.
    isPartial: false,
    syncedAt: input.syncedAt,
    syncRunId: input.syncRunId,
    providerMetrics: values.providerMetrics,
  };
}

type MetricEntry = Record<string, unknown>;

function readMetrics(payload: unknown): Map<string, MetricEntry> & {
  providerMetrics: Record<string, unknown>;
} {
  if (!isRecord(payload) || !Array.isArray(payload.data)) invalid();

  const metrics = new Map<string, MetricEntry>() as Map<string, MetricEntry> & {
    providerMetrics: Record<string, unknown>;
  };
  metrics.providerMetrics = {};

  for (const candidate of payload.data) {
    if (!isRecord(candidate) || typeof candidate.name !== 'string') invalid();
    const name = candidate.name.trim();
    if (!name || metrics.has(name)) invalid();

    metrics.set(name, candidate);
    metrics.providerMetrics[name] = jsonValue({
      period: candidate.period,
      values: candidate.values,
      total_value: candidate.total_value,
    });
  }

  return metrics;
}

/**
 * A metric whose value is a single number rather than a distribution.
 *
 * The account-level engagement counters (`profile_views`, `accounts_engaged`,
 * `total_interactions` and the interaction counts) are requested without a
 * `breakdown`, so Meta answers with a bare `total_value.value`. Absent metric,
 * absent value and an explicit null all read as null; an explicit `0` survives
 * as `"0"`, because a day with no profile visits is a measurement.
 */
function readPlainTotal(metric: MetricEntry | undefined): string | null {
  if (!metric) return null;

  return readOptionalCounter(rawMetricValue(metric));
}

/**
 * One plain daily counter out of a Page series metric.
 *
 * These metrics answer with a `values` array and no breakdown. The caller reads
 * them inside the per-day loop with a one-day range, so the array holds the day
 * being normalized and `rawMetricValue`'s "newest entry" is that day — there is
 * no date matching to do here, and doing it would only re-derive what the
 * request already constrained.
 *
 * Null rather than zero when the metric is absent, which is the rule everywhere
 * in this file: a Page that has never had a Messenger conversation and a read
 * that failed must not produce the same row.
 */
function readDaySeriesValue(metric: MetricEntry | undefined): string | null {
  if (!metric) return null;

  return readOptionalCounter(rawMetricValue(metric));
}

function readOrganicBreakdown(metric: MetricEntry | undefined): string | null {
  if (!metric) return null;
  const value = rawMetricValue(metric);
  if (!isRecord(value) || !hasOwn(value, 'organic')) return null;
  return readRequiredCounter(value.organic);
}

function readNonAdMediaProducts(
  metric: MetricEntry | undefined,
): string | null {
  if (!metric || !isRecord(metric.total_value)) return null;
  const breakdowns: unknown = metric.total_value.breakdowns;
  if (!Array.isArray(breakdowns)) return null;

  let total = 0n;
  let found = false;
  for (const breakdown of breakdowns as unknown[]) {
    if (!isRecord(breakdown) || !Array.isArray(breakdown.dimension_keys)) {
      invalid();
    }
    if (!breakdown.dimension_keys.includes('media_product_type')) continue;
    // A breakdown with no `results` key at all is Meta's shape for a day in
    // which nothing happened — observed in production on 2026-09-21. That is an
    // absence of activity, not a malformed answer, so it contributes nothing
    // and the other breakdowns still count. A `results` that is present but not
    // an array remains a broken payload and still refuses.
    if (!hasOwn(breakdown, 'results')) continue;
    if (!Array.isArray(breakdown.results)) invalid();

    for (const result of breakdown.results as unknown[]) {
      if (!isRecord(result) || !Array.isArray(result.dimension_values)) {
        invalid();
      }
      const product: unknown = result.dimension_values[0];
      if (product === 'AD') continue;
      // Meta v26 documents REEL (with REELS as an equivalent response),
      // STORY, and POST/CAROUSEL_CONTAINER as the concrete FEED subtypes.
      if (
        !['POST', 'CAROUSEL_CONTAINER', 'STORY', 'REEL', 'REELS'].includes(
          String(product),
        )
      ) {
        continue;
      }
      total += BigInt(readRequiredCounter(result.value));
      found = true;
    }
  }

  return found ? total.toString() : null;
}

function readBreakdownDimension(
  metric: MetricEntry | undefined,
  expected: 'FOLLOWER' | 'NON_FOLLOWER',
): string | null {
  if (!metric || !isRecord(metric.total_value)) return null;
  const breakdowns: unknown = metric.total_value.breakdowns;
  if (!Array.isArray(breakdowns)) return null;

  for (const breakdown of breakdowns as unknown[]) {
    if (
      !isRecord(breakdown) ||
      !Array.isArray(breakdown.dimension_keys) ||
      !breakdown.dimension_keys.includes('follow_type')
    ) {
      continue;
    }
    // Same absence-is-zero rule as `readNonAdMediaProducts`: a `follow_type`
    // breakdown that carries no `results` is a day with no follows or
    // unfollows, which reads as null rather than failing the whole run.
    if (!hasOwn(breakdown, 'results')) return null;
    if (!Array.isArray(breakdown.results)) invalid();
    const results = breakdown.results as unknown[];
    const result: unknown = results.find(
      (candidate) =>
        isRecord(candidate) &&
        Array.isArray(candidate.dimension_values) &&
        candidate.dimension_values[0] === expected,
    );
    return result && isRecord(result)
      ? readRequiredCounter(result.value)
      : null;
  }

  return null;
}

function rawMetricValue(metric: MetricEntry): unknown {
  if (isRecord(metric.total_value) && hasOwn(metric.total_value, 'value')) {
    return metric.total_value.value;
  }
  const values: unknown = metric.values;
  if (!Array.isArray(values) || values.length === 0) return null;
  const value: unknown = (values as unknown[]).at(-1);
  if (!isRecord(value) || !hasOwn(value, 'value')) invalid();
  return value.value;
}

function readOptionalCounter(value: unknown): string | null {
  return value === undefined || value === null
    ? null
    : readRequiredCounter(value);
}

function readRequiredCounter(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) invalid();
    return String(value);
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) invalid();
  return BigInt(value.trim()).toString();
}

function accountFact(
  input: NormalizeBase,
  values: Partial<NormalizedOrganicAccountMetricDaily> & {
    providerMetrics: Record<string, unknown>;
  },
): NormalizedOrganicAccountMetricDaily {
  return {
    ...baseFact(input),
    followersCount: values.followersCount ?? null,
    followersGained: values.followersGained ?? null,
    followersLost: values.followersLost ?? null,
    impressions: values.impressions ?? null,
    reach: values.reach ?? null,
    // Null for a Facebook Page, which has no metric that answers this: the
    // Page reader asks for `page_media_view`, and there is no ads-inclusive
    // account total on that side of the API.
    viewsTotal: values.viewsTotal ?? null,
    reachTotal: values.reachTotal ?? null,
    profileViews: values.profileViews ?? null,
    totalInteractions: values.totalInteractions ?? null,
    accountsEngaged: values.accountsEngaged ?? null,
    likes: values.likes ?? null,
    comments: values.comments ?? null,
    shares: values.shares ?? null,
    saves: values.saves ?? null,
    replies: values.replies ?? null,
    // Facebook Page only; Instagram has no daily equivalent and leaves these
    // null, keeping `followersCount` as its follower figure.
    pageFollows: values.pageFollows ?? null,
    pageDailyFollows: values.pageDailyFollows ?? null,
    pageDailyUnfollows: values.pageDailyUnfollows ?? null,
    viewsOrganic: values.viewsOrganic ?? null,
    viewsPaid: values.viewsPaid ?? null,
    newConversations: values.newConversations ?? null,
    providerMetrics: values.providerMetrics,
  };
}

function baseFact(input: NormalizeBase) {
  return {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agencyClientId: input.agencyClientId,
    assetId: input.assetId,
    provider: input.provider,
    source: 'organic' as const,
    metricDate: input.metricDate,
    assetTimezone: input.assetTimezone,
    isPartial: input.metricDate === input.currentDay,
    syncedAt: input.syncedAt,
    syncRunId: input.syncRunId,
  };
}

function withSnapshot(
  metrics: Record<string, unknown>,
  snapshot: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...metrics };
  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function jsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key, jsonValue(entry)] as const)
        .filter(([, entry]) => entry !== undefined),
    );
  }
  invalid();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function invalid(): never {
  throw new MetaOrganicInsightsNormalizationError();
}
