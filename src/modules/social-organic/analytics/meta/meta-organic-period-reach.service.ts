import { Injectable } from '@nestjs/common';
import type { ResolvedOrganicAnalyticsCredential } from '../../credentials/social-organic-credential.resolver';
import { MetaOrganicGraphService } from '../../providers/meta/meta-organic-graph.service';
import { socialOrganicSurfaceSpellings } from '../views/social-organic-top-posts.view';
import { FACEBOOK_PAGE_PERIOD_METRICS } from './meta-organic-insights.types';

/**
 * The de-duplicated organic reach of a whole period, measured by Meta.
 *
 * ## Why this service exists
 *
 * The organic overview has always returned `reach: null` for any window longer
 * than a day, and the card showed a dash. That was correct — reach is unique
 * people, and summing daily figures counts anyone reached on two days twice —
 * but "correct and always empty" is not a usable answer when every competing
 * report shows the number.
 *
 * ## What Meta actually offers, verified against production on 2026-09-23
 *
 * - `period=days_28` → `(#100) The following periods (days_28) are incompatible
 *   with the metric (reach)`.
 * - `period=week` → the same refusal.
 * - a range with no `period` → `(#100) the parameter period is required`.
 * - **`period=day` + `metric_type=total_value` + `since`/`until` → one row whose
 *   `total_value.value` is de-duplicated across the whole range.**
 *
 * That last shape is the mechanism. On the production account, 1–23 September
 * returned 6 742 while the daily values over the same range sum to far more:
 * the difference is exactly the people who appeared on more than one day, and
 * Meta removed them where the identities are. No local arithmetic could have.
 *
 * `period=day` here does *not* mean "one day". It selects the daily metric, and
 * `metric_type=total_value` without a `breakdown` collapses the series Meta
 * would otherwise return into a single de-duplicated figure for the range.
 *
 * ## Why it is not folded into the daily sync
 *
 * The daily ingest asks with `breakdown=media_product_type`, because it needs
 * organic-only values split by surface and must exclude the AD bucket. This
 * read deliberately omits the breakdown — Meta only collapses to one
 * de-duplicated total when nothing splits it — so the number here **includes
 * ads**, exactly as Meta's own "Contas alcançadas" does. The two are different
 * measurements and are stored in different places for that reason; see
 * `periodReachIncludesAds` on the view.
 *
 * Mirrors `MetaAdsReachReaderService` on the paid side, which solved the same
 * problem with the same shape (there: omitting `time_increment`).
 */
@Injectable()
export class MetaOrganicPeriodReachService {
  constructor(private readonly graph: MetaOrganicGraphService) {}

  /**
   * One measurement for one asset and range, or null when Meta reported none.
   *
   * Null is a first-class answer, never zero: an account Meta has no reach for
   * and an account nobody saw are different statements, and the caller renders
   * them differently.
   */
  async measure(input: {
    resolved: ResolvedOrganicAnalyticsCredential;
    /** Calendar days in the asset's own timezone, inclusive. */
    since: string;
    until: string;
  }): Promise<{ reach: string | null; apiCalls: number }> {
    const measured = await this.measurePeriod(input);

    return { reach: measured.reach, apiCalls: measured.apiCalls };
  }

  /**
   * Views and reach for the range, each as a total and split organic vs paid.
   *
   * One call per metric, both in the collapsing shape `measure` documents, and
   * `breakdown=media_product_type` on top of it. The breakdown is what makes the
   * split possible, and it does not cost a second request: Meta returns
   * `total_value.value` *and* `total_value.breakdowns` in the same answer, so
   * the total and the slices come back together.
   *
   * The paid slice is Meta's own `AD` bucket, never `total - organic`. Meta
   * de-duplicates the total across both, so an account reached organically and
   * by an ad is counted once in the total and once in each slice — subtracting
   * would state a number Meta did not report. On the production account this
   * was verified against, 30 days gave a total reach of 6 783 where the slices
   * were 6 645 paid and 156 organic, which sum to 6 801.
   */
  async measurePeriod(input: {
    resolved: ResolvedOrganicAnalyticsCredential;
    since: string;
    until: string;
  }): Promise<MetaOrganicPeriodMeasurement> {
    const { credential } = input.resolved;

    // A Page answers a different, smaller set, and no reach at all:
    // `page_impressions_unique` was retired along with every other
    // unique-audience metric. `measurePage` reads what is left.
    if (credential.assetType === 'facebook_page') {
      return this.measurePage(input);
    }

    if (credential.assetType !== 'instagram_professional') {
      return { ...EMPTY_MEASUREMENT, apiCalls: 0 };
    }

    // Meta refuses a range wider than 30 days outright — verified on
    // 2026-09-24: `(#100) There cannot be more than 30 days (2592000 s) between
    // since and until`. Asking anyway spends a call to get an error and leaves
    // the card empty, so the window is clamped to its last 30 days and the
    // range actually measured is returned for the caller to label. A card that
    // says "90 dias" over a 30-day figure is the failure this prevents.
    const window = clampToMaxWindow(input.since, input.until);

    // The engagement family takes the same breakdown, verified against
    // production on 2026-09-24: `total_interactions`, `likes`, `comments`,
    // `saves` and `shares` all answer with `media_product_type` slices. The one
    // that does not is `replies` — it fails with an opaque
    // `(#100) An unknown error has occurred`, so story replies come from the
    // un-broken-down account metric the daily sync already collects, and are
    // not asked for here.
    const [views, reach, interactions, likes, comments, saves, shares] =
      await Promise.all([
        this.readMetric(credential, 'views', window),
        this.readMetric(credential, 'reach', window),
        this.readMetric(credential, 'total_interactions', window),
        this.readMetric(credential, 'likes', window),
        this.readMetric(credential, 'comments', window),
        this.readMetric(credential, 'saves', window),
        this.readMetric(credential, 'shares', window),
      ]);

    return {
      views: views.total,
      viewsOrganic: views.organic,
      viewsPaid: views.paid,
      viewsFeed: views.feed,
      viewsReel: views.reel,
      viewsStory: views.story,
      reach: reach.total,
      reachOrganic: reach.organic,
      reachPaid: reach.paid,
      reachFeed: reach.feed,
      reachReel: reach.reel,
      reachStory: reach.story,
      interactionsReel: interactions.reel,
      interactionsStory: interactions.story,
      likesReel: likes.reel,
      commentsReel: comments.reel,
      savesReel: saves.reel,
      sharesReel: shares.reel,
      sharesStory: shares.story,
      // Instagram has no Page view count; `views` above is its own metric.
      pageViews: null,
      measuredSince: window.since,
      measuredUntil: window.until,
      truncated: window.truncated,
      apiCalls:
        views.apiCalls +
        reach.apiCalls +
        interactions.apiCalls +
        likes.apiCalls +
        comments.apiCalls +
        saves.apiCalls +
        shares.apiCalls,
    };
  }

  /**
   * What a Facebook Page can still report for a window.
   *
   * ## There is no reach here, and that is the finding
   *
   * Every unique-audience metric a Page used to answer has been retired.
   * Verified against production on 2026-09-24 across `page_impressions_unique`,
   * `page_views_unique`, `page_content_viewers`, `page_daily_unique_viewers`
   * and a dozen other spellings, all returning `(#100) The value must be a
   * valid insights metric` — the same error an invented name gets. So a Page
   * cannot say how many people it reached, and nothing here pretends to. The
   * only Facebook surface that still reports unique viewers is a reel, through
   * `/{reel}/video_insights`.
   *
   * ## Why the total is summed here rather than asked for
   *
   * `page_media_view` has no `metric_type=total_value` collapsing shape — the
   * trick that gives Instagram a de-duplicated period figure in one call.
   * Verified: the breakdown parameters Instagram accepts are all refused here
   * (`(#100) The breakdown value is invalid`), and the metric answers as a
   * plain daily series.
   *
   * Summing a daily series is only sound because this is a **view count**, not
   * an audience: two views on two days are two views, and there is nobody to
   * double-count. The same arithmetic on a reach metric would be wrong, which
   * is the reason this module refuses to do it anywhere else — see the class
   * docblock. That distinction is the whole justification for the `+=` below.
   */
  private async measurePage(input: {
    resolved: ResolvedOrganicAnalyticsCredential;
    since: string;
    until: string;
  }): Promise<MetaOrganicPeriodMeasurement> {
    const { credential } = input.resolved;

    const response = await this.graph.getOrganicInsights({
      objectId: credential.externalAssetId,
      accessToken: credential.accessToken,
      metrics: FACEBOOK_PAGE_PERIOD_METRICS,
      period: 'day',
      since: toUnixDay(input.since),
      until: toUnixDay(input.until) + DAY_SECONDS,
    });

    return {
      ...EMPTY_MEASUREMENT,
      pageViews: readDailySeriesSum(response.data, 'page_media_view'),
      // The engagement three are not read here. `page_post_engagements` exists
      // but lumps reactions, comments, shares and clicks into one number that
      // cannot be split back apart, so the read layer sums them from the post
      // table instead — where each is stored separately and per post.
      measuredSince: input.since,
      measuredUntil: input.until,
      // No clamp: the 30-day ceiling is an Instagram `total_value` limit, and a
      // plain daily series has no such restriction.
      truncated: false,
      apiCalls: response.apiCalls,
    };
  }

  private async readMetric(
    credential: ResolvedOrganicAnalyticsCredential['credential'],
    metric:
      | 'views'
      | 'reach'
      | 'total_interactions'
      | 'likes'
      | 'comments'
      | 'saves'
      | 'shares',
    window: { since: string; until: string },
  ): Promise<{
    total: string | null;
    organic: string | null;
    paid: string | null;
    feed: string | null;
    reel: string | null;
    story: string | null;
    apiCalls: number;
  }> {
    const response = await this.graph.getOrganicInsights({
      objectId: credential.externalAssetId,
      accessToken: credential.accessToken,
      metrics: [metric],
      period: 'day',
      metricType: 'total_value',
      breakdown: 'media_product_type',
      // `until` is exclusive on this edge, so the last day is included by
      // asking for the instant after it rather than by shifting the caller's
      // calendar day — which would make the stored range disagree with the one
      // requested.
      since: toUnixDay(window.since),
      until: toUnixDay(window.until) + DAY_SECONDS,
    });

    return {
      total: readTotalValue(response.data),
      organic: readSurfaceSum(response.data, 'organic'),
      paid: readSurfaceSum(response.data, 'paid'),
      // All read from the same response: the per-surface figures cost no extra
      // call, they are more ways of reading the breakdown already in hand.
      feed: readSurfaceSum(response.data, 'feed'),
      reel: readSurfaceSum(response.data, 'reel'),
      story: readSurfaceSum(response.data, 'story'),
      apiCalls: response.apiCalls,
    };
  }
}

export type MetaOrganicPeriodMeasurement = {
  views: string | null;
  viewsOrganic: string | null;
  viewsPaid: string | null;
  reach: string | null;
  reachOrganic: string | null;
  reachPaid: string | null;
  /**
   * The per-surface slices, each a **subset of the organic slice** rather than
   * a further bucket beside it, and not a partition of it either: Meta
   * de-duplicates within each, so an account that saw both a story and a reel
   * is counted once in `reachOrganic` and once in each of the two. They must
   * never be added to each other or subtracted from the organic total.
   *
   * `reachFeed` is what Meta calls "Alcance das postagens".
   */
  reachFeed: string | null;
  reachReel: string | null;
  reachStory: string | null;
  viewsFeed: string | null;
  viewsReel: string | null;
  viewsStory: string | null;
  /**
   * The engagement family, sliced by the same breakdown.
   *
   * Only the surfaces a card asks for are carried: reels and stories. The feed
   * equivalents are not, because the feed's engagement is already answered
   * per-post by the posts table, at a grain that can be ranked.
   */
  interactionsReel: string | null;
  interactionsStory: string | null;
  likesReel: string | null;
  commentsReel: string | null;
  savesReel: string | null;
  sharesReel: string | null;
  sharesStory: string | null;
  /**
   * `page_media_view` summed over the window — Facebook only, null on
   * Instagram.
   *
   * A separate field from `views` rather than the same one, because they are
   * different measurements: this counts Page content appearing on screen,
   * while `views` is Instagram's own metric with its own de-duplication. One
   * field holding either would invite a consolidated report to add two numbers
   * Meta never meant to be added.
   */
  pageViews: string | null;
  /** The range actually asked for, which a clamp may have narrowed. */
  measuredSince: string;
  measuredUntil: string;
  /** True when the caller's window was wider than Meta allows. */
  truncated: boolean;
  apiCalls: number;
};

const EMPTY_MEASUREMENT = {
  views: null,
  viewsOrganic: null,
  viewsPaid: null,
  reach: null,
  reachOrganic: null,
  reachPaid: null,
  reachFeed: null,
  reachReel: null,
  reachStory: null,
  viewsFeed: null,
  viewsReel: null,
  viewsStory: null,
  interactionsReel: null,
  interactionsStory: null,
  likesReel: null,
  commentsReel: null,
  savesReel: null,
  sharesReel: null,
  sharesStory: null,
  pageViews: null,
  measuredSince: '',
  measuredUntil: '',
  truncated: false,
} satisfies Omit<MetaOrganicPeriodMeasurement, 'apiCalls'>;

/** Meta's hard limit on this edge, in days, inclusive of both ends. */
const MAX_WINDOW_DAYS = 30;

function clampToMaxWindow(
  since: string,
  until: string,
): { since: string; until: string; truncated: boolean } {
  const spanDays =
    Math.round(
      (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) /
        (DAY_SECONDS * 1000),
    ) + 1;

  if (spanDays <= MAX_WINDOW_DAYS) return { since, until, truncated: false };

  // Keep the end of the range, not the start: the question is always "how is it
  // doing", and the most recent 30 days answer that where the oldest 30 would
  // describe a period the operator has already scrolled past.
  const clampedSince = new Date(
    Date.parse(`${until}T00:00:00Z`) -
      (MAX_WINDOW_DAYS - 1) * DAY_SECONDS * 1000,
  )
    .toISOString()
    .slice(0, 10);

  return { since: clampedSince, until, truncated: true };
}

const DAY_SECONDS = 86_400;

/** A `YYYY-MM-DD` calendar day as the Unix second Meta expects. */
function toUnixDay(day: string): number {
  return Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);
}

/**
 * The one `total_value.value` in the response, as a digit string.
 *
 * Anything else — no rows, a row without the field, a non-finite number — is
 * null rather than zero, for the reason `measure` documents.
 *
 * A `breakdowns` array beside the value is expected and fine: `measurePeriod`
 * asks with `breakdown=media_product_type` and Meta answers with the
 * de-duplicated total *and* the slices in the same object. What would be wrong
 * is a `total_value` carrying only breakdowns and no `value` of its own —
 * `follows_and_unfollows` answers that way — and that case falls through to the
 * null below rather than being read as a zero.
 */
function readTotalValue(data: unknown[]): string | null {
  const totalValue = readTotalValueObject(data);

  if (!totalValue) return null;

  const value = (totalValue as { value?: unknown }).value;

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.trunc(value).toString();
}

/**
 * A plain daily series, summed across the window.
 *
 * The shape a Facebook Page metric answers in: `values: [{value, end_time},
 * ...]`, one entry per day, with no `total_value` to collapse to. Summing is
 * sound here and nowhere else in this file — see `measurePage` for why a view
 * count may be added across days while an audience may not.
 *
 * Null when the metric is absent entirely, zero when every day reported zero.
 * The distinction matters: a Page that published nothing and a metric Meta
 * stopped answering look the same in a total and are not the same fact.
 */
function readDailySeriesSum(data: unknown[], metric: string): string | null {
  let total = 0n;
  let found = false;

  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue;

    const row = entry as { name?: unknown; values?: unknown };
    if (row.name !== metric || !Array.isArray(row.values)) continue;

    for (const day of row.values as unknown[]) {
      if (!day || typeof day !== 'object') continue;

      const value = (day as { value?: unknown }).value;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        continue;
      }

      total += BigInt(Math.trunc(value));
      found = true;
    }
  }

  return found ? String(total) : null;
}

function readTotalValueObject(data: unknown[]): object | null {
  const [first] = data;

  if (!first || typeof first !== 'object') return null;

  const totalValue = (first as { total_value?: unknown }).total_value;

  return totalValue && typeof totalValue === 'object' ? totalValue : null;
}

/**
 * The `media_product_type` surfaces that make up each slice.
 *
 * `AD` is the paid bucket and everything else is organic — the same division
 * `readNonAdMediaProducts` makes in the daily normalizer, kept in step with it
 * deliberately so that a day and a period answer the same question the same
 * way. An unrecognised surface counts as organic: it is content the account
 * published, and dropping it would understate the organic slice.
 *
 * `feed`, `reel` and `story` are narrower than organic and are not further
 * buckets beside it: each is a subset of the organic slice, and the three do
 * not partition it either, because Meta de-duplicates within each. An account
 * that saw a story and a reel is one account in `organic` and one in each of
 * those two. Their spellings come from `socialOrganicSurfaceSpellings` so the
 * period figures and the per-surface post tables cannot drift apart on what
 * counts as a post — Meta writes the same surface as `FEED`, `POST` and
 * `CAROUSEL_CONTAINER` depending on the edge.
 */
function readSurfaceSum(
  data: unknown[],
  slice: 'organic' | 'paid' | 'feed' | 'reel' | 'story',
): string | null {
  const surfaceSpellings =
    slice === 'feed' || slice === 'reel' || slice === 'story'
      ? new Set(socialOrganicSurfaceSpellings(slice))
      : null;
  const totalValue = readTotalValueObject(data);
  const breakdowns = (totalValue as { breakdowns?: unknown } | null)
    ?.breakdowns;

  if (!Array.isArray(breakdowns)) return null;

  let total = 0n;
  let found = false;

  for (const breakdown of breakdowns as unknown[]) {
    if (!breakdown || typeof breakdown !== 'object') continue;

    const entry = breakdown as { dimension_keys?: unknown; results?: unknown };
    if (
      !Array.isArray(entry.dimension_keys) ||
      !entry.dimension_keys.includes('media_product_type')
    ) {
      continue;
    }
    // A breakdown with no `results` is Meta's shape for a range in which
    // nothing happened, not a malformed answer — the same tolerance the daily
    // normalizer applies.
    if (!Array.isArray(entry.results)) continue;

    for (const result of entry.results as unknown[]) {
      if (!result || typeof result !== 'object') continue;

      const row = result as { dimension_values?: unknown; value?: unknown };
      if (!Array.isArray(row.dimension_values)) continue;

      const surface = String(row.dimension_values[0]).toUpperCase();
      const isPaid = surface === 'AD';

      if (surfaceSpellings) {
        if (!surfaceSpellings.has(surface)) continue;
      } else if (isPaid !== (slice === 'paid')) {
        continue;
      }

      const value = row.value;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        continue;
      }

      total += BigInt(Math.trunc(value));
      found = true;
    }
  }

  return found ? total.toString() : null;
}
