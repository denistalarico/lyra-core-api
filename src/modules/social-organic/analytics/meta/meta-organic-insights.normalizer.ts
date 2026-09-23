import type {
  NormalizedOrganicAccountMetricDaily,
  NormalizedOrganicPostMetricDaily,
} from '../social-organic-insights.contract';

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
  },
): NormalizedOrganicAccountMetricDaily | null {
  const metrics = readMetrics(input.insights);
  const followersCount =
    input.metricDate === input.currentDay
      ? readOptionalCounter(input.followersCount)
      : null;
  const impressions = readOrganicBreakdown(metrics.get('page_media_view'));

  if (followersCount === null && impressions === null) return null;

  return accountFact(input, {
    followersCount,
    impressions,
    providerMetrics: withSnapshot(metrics.providerMetrics, {
      followers_count:
        input.metricDate === input.currentDay
          ? jsonValue(input.followersCount)
          : undefined,
    }),
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
  input: PostLifetimeBase & { insights: unknown },
): NormalizedOrganicPostMetricDaily | null {
  const metrics = readMetrics(input.insights);
  const impressionsLifetime = readLifetimeCounter(
    metrics.get('post_media_view'),
  );

  if (impressionsLifetime === null) return null;

  return postLifetimeFact(input, {
    impressionsLifetime,
    impressionsLifetimeObservedAt: input.observedAt,
    providerMetrics: metrics.providerMetrics,
  });
}

/**
 * IG media lifetime snapshot (A2 §1). One batched call for `comments`,
 * `likes` and `views` — all three are documented only as `period=lifetime`.
 * Returns whichever subset of the three is actually present in the response
 * (not all-or-nothing): a partial IG response still carries real evidence for
 * the metrics it does report. Only returns `null` if all three are absent.
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
    ranking.every((value) => value === null)
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
    // Stamped only when at least one of them was actually read, so the column
    // never claims an observation that produced nothing.
    lifetimeObservedAt: ranking.some((value) => value !== null)
      ? input.observedAt
      : null,
    providerMetrics: metrics.providerMetrics,
  });
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
    profileViews: values.profileViews ?? null,
    totalInteractions: values.totalInteractions ?? null,
    accountsEngaged: values.accountsEngaged ?? null,
    likes: values.likes ?? null,
    comments: values.comments ?? null,
    shares: values.shares ?? null,
    saves: values.saves ?? null,
    replies: values.replies ?? null,
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
