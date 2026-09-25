/**
 * How each day of the week performs for publishing.
 *
 * ## The average is the answer, not the total
 *
 * The card asks "which day is best to post", and the honest answer is the
 * average a post gets on that day. A sum answers a different question — when
 * the audience was most active — and would be decided by how many times the
 * operator happened to publish: a Tuesday with three posts beats a Thursday
 * with one whatever those posts did, so the "best day" would drift toward the
 * day they already post most. The recommendation would then be to keep doing
 * what they are doing, derived circularly from what they did.
 *
 * `total` is carried anyway, because a reader comparing two days wants to know
 * whether an average rests on one post or twenty — an average of 900 from a
 * single lucky post is not advice.
 *
 * ## Why views and not reach
 *
 * A Facebook Page has no de-duplicated reach left to report; every unique
 * metric it once had is retired. Views is what remains, and it is what the
 * operator's own Page dashboard shows, so the two agree.
 */
export type SocialOrganicWeekdayBucket = {
  /** ISO-8601 day of week: 1 = Monday … 7 = Sunday. */
  weekday: number;
  /** How many publications fell on this weekday in the period. */
  publications: number;
  /** Their summed views, or null when none of them reported any. */
  total: string | null;
  /**
   * Views per publication, rounded to one decimal.
   *
   * Null rather than zero when `publications` is zero: a weekday nothing was
   * published on has no average, and a zero there would draw as the worst
   * possible day rather than as an absence of evidence.
   */
  average: string | null;
};

export type SocialOrganicWeekdayView = {
  assetId: string;
  timezone: string;
  period: { since: string; until: string };
  /** Always seven entries, Monday first, including weekdays with no posts. */
  buckets: SocialOrganicWeekdayBucket[];
  /**
   * The weekday with the highest average, or null.
   *
   * Null when nothing was published in the period, and also when fewer than
   * `MIN_PUBLICATIONS_FOR_BEST_DAY` publications exist across the whole window:
   * naming a "best day" from two posts is a coin toss presented as a finding,
   * and an operator will act on it.
   */
  bestWeekday: number | null;
};

/**
 * Below this, no day is named.
 *
 * Seven is one week's worth of daily posting, and the point at which at least
 * some weekdays have more than a single observation behind them. It is a
 * judgement rather than a statistical test — the honest alternative would be
 * confidence intervals the card has no room to explain.
 */
export const MIN_PUBLICATIONS_FOR_BEST_DAY = 7;

/** Monday-first, so a chart reads like a calendar week. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 7] as const;

export function emptyWeekdayBucket(
  weekday: number,
): SocialOrganicWeekdayBucket {
  return { weekday, publications: 0, total: null, average: null };
}

/**
 * The best weekday among buckets, or null when the evidence is too thin.
 *
 * Ties break toward the earlier weekday, which is arbitrary but stable: the
 * alternative is an order that depends on how Postgres returned the rows, so
 * the same data would name a different best day between two page loads.
 */
export function pickBestWeekday(
  buckets: readonly SocialOrganicWeekdayBucket[],
): number | null {
  const publications = buckets.reduce(
    (sum, bucket) => sum + bucket.publications,
    0,
  );

  if (publications < MIN_PUBLICATIONS_FOR_BEST_DAY) return null;

  let best: SocialOrganicWeekdayBucket | null = null;

  for (const bucket of buckets) {
    if (bucket.average === null) continue;
    if (best === null || Number(bucket.average) > Number(best.average)) {
      best = bucket;
    }
  }

  return best?.weekday ?? null;
}
