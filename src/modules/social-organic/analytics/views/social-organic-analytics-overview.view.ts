/**
 * Which grain the returned `reach` was measured at.
 *
 * Reach is de-duplicated audience, so it is the one metric that cannot be
 * summed — see `social_organic_account_metrics_daily`'s entity docblock.
 * `daily` means "the stored per-day figures, which you may not add"; this
 * mirrors `SocialAdReachGranularity` in the paid module exactly, for the same
 * reason.
 */
export type SocialOrganicReachGranularity = 'daily';

/**
 * The additive totals of one period for one organic asset.
 *
 * Narrower than paid's `SocialAdAnalyticsTotals` on purpose: the account
 * table has no spend, click or conversion counters, and no engagement-rate
 * inputs (likes/comments/shares/saves live only at post grain, which this
 * first pass of A3 does not read — see the read service's docblock on the
 * deferred `posts()` follow-up). Every numeric field is a decimal *string*,
 * matching every other analytics surface in this codebase: the underlying
 * columns are `bigint`, which exceeds what an IEEE-754 double represents
 * exactly above 2^53.
 */
export type SocialOrganicAnalyticsTotals = {
  impressions: string;

  /** Null unless the period is exactly one day and that day reported it. */
  reach: string | null;
  reachGranularity: SocialOrganicReachGranularity;

  /**
   * The de-duplicated reach of the whole period, measured by Meta — not a sum.
   *
   * The number the dashboard actually shows. `reach` above is the daily grain
   * and is null for any real reporting window, which left the card showing a
   * dash forever; this is measured by asking Meta for the range in one request,
   * so the de-duplication happens where the identities are.
   *
   * **It includes ads.** Meta only collapses reach to one period figure when
   * nothing breaks it down, and the breakdown is what the daily ingest uses to
   * exclude the AD bucket. So this matches Meta's own "Contas alcançadas" and is
   * a different measurement from summing `reach` — which is why the two are
   * separate fields rather than one field with a flag.
   *
   * Null when not measured: Instagram only (Meta retired the Page equivalent),
   * and null while the first measurement for a window has not been taken.
   */
  periodReach: string | null;
  /** True whenever `periodReach` is non-null — it is never ads-free. */
  periodReachIncludesAds: boolean;

  /**
   * The same measured window split the way Meta splits it, plus the views
   * equivalent — what the "Alcance total" and "Visualizações totais" cards show.
   *
   * ## These three do not add up, by design
   *
   * `periodReachOrganic + periodReachPaid` is larger than `periodReach`.
   * Verified against production: 156 + 6 645 = 6 801 against a total of 6 783.
   * An account reached both organically and by an ad is one account in the
   * total and one in each slice, so the excess is the overlap.
   *
   * A card may therefore show all three, and must not show one as a percentage
   * of another or present the pair as a stacked bar summing to the total.
   *
   * Null means the window was measured but Meta returned no breakdown for it —
   * distinct from zero, which would assert that nothing was paid.
   */
  periodReachOrganic: string | null;
  periodReachPaid: string | null;

  /** Total views of the measured window, ads included; slices on the same terms. */
  periodViews: string | null;
  periodViewsOrganic: string | null;
  periodViewsPaid: string | null;

  /**
   * The range the figures above actually describe.
   *
   * Meta refuses a window wider than 30 days, so a longer request is measured
   * over its last 30 and `periodTruncated` says so. The card labels itself from
   * these rather than from the requested period — a "últimos 90 dias" heading
   * over a 30-day number is the failure this exists to prevent.
   *
   * Null when no measurement exists for the window at all.
   */
  periodMeasuredSince: string | null;
  periodMeasuredUntil: string | null;
  periodTruncated: boolean;

  /**
   * Reach of feed posts alone in the measured window — "Alcance das postagens".
   *
   * Excludes reels and stories, and comes from Meta's own `media_product_type`
   * breakdown rather than from adding the per-post reach figures: post reach is
   * de-duplicated per post, so summing it counts a follower who saw three posts
   * three times.
   *
   * Instagram only, and null when the window carries no breakdown.
   */
  periodFeedReach: string | null;

  /**
   * The same measurement for reels and for stories.
   *
   * Each is a subset of the organic slice and none of the three surfaces
   * partitions it: Meta de-duplicates within each, so an account that saw both
   * a story and a reel is counted once in the organic total and once in each of
   * these. They must not be added to each other.
   *
   * Instagram only, and null when the window carries no breakdown.
   */
  periodReelReach: string | null;
  periodStoryReach: string | null;
  periodFeedViews: string | null;
  periodReelViews: string | null;
  periodStoryViews: string | null;

  /**
   * Engagement for the same window, by surface.
   *
   * Unlike reach these are ordinary additive counters — a like is a like — but
   * they still come from Meta's breakdown rather than from summing per-post
   * rows, because the per-post rows only exist for content a sync caught, and
   * because a story's engagement has no per-post source at all once the story
   * has expired.
   */
  periodReelInteractions: string | null;
  periodStoryInteractions: string | null;
  periodReelLikes: string | null;
  periodReelComments: string | null;
  periodReelSaves: string | null;
  periodReelShares: string | null;
  periodStoryShares: string | null;

  /**
   * How many reels and stories were published in the period.
   *
   * Counted from the stored publications rather than measured: Meta has no
   * metric for "how many reels", and the question is about content rather than
   * about a window's audience.
   *
   * `storyCount` is a floor, not a certainty. A story is only ever visible to
   * the collector while it is live, so one posted and expired between two
   * hourly passes was never recorded — and unlike every other figure here, that
   * gap can never be filled.
   */
  periodReelCount: string;
  periodStoryCount: string;
  /**
   * The Facebook Page figures. Null or zero on an Instagram asset.
   *
   * There is no `pageReach` and there will not be one: Meta retired every
   * unique-audience metric a Page reported — `page_impressions_unique`,
   * `page_views_unique`, `page_content_viewers` and the rest all answer
   * `(#100) The value must be a valid insights metric`. A Page cannot say how
   * many people it reached, so the dashboard does not offer the card.
   *
   * `pageViews` is measured by Meta for the window and may be null. The other
   * four are summed or counted from stored rows, so zero is a real answer and
   * they are never null.
   */
  pageViews: string | null;
  pageReactions: string;
  pageComments: string;
  pageShares: string;
  pagePostCount: string;
  pageReelCount: string;
  /**
   * The reel aggregates, summed over the reels published in the window.
   *
   * `pageReelViewers` is the one that overstates, and knowingly: Meta reports
   * unique viewers per reel and offers no de-duplicated union, so an account
   * that watched two reels is counted twice. It is kept because it is the only
   * unique-viewer figure left anywhere on the Facebook side, and the card's
   * description says what it is.
   */
  pageReelPlays: string;
  pageReelViewers: string;
  pageReelWatchTimeSeconds: string;
  pageReelReactions: string;
  pageReelComments: string;
  pageReelShares: string;

  /**
   * STOCK, not flow — the latest observed value inside the period, never a
   * sum. Null when the period has no observation at all.
   */
  followersCount: string | null;

  /** Daily flow; safe to sum across the period. */
  followersGained: string;
  /** Daily flow; safe to sum across the period. */
  followersLost: string;

  profileViews: string;

  /**
   * Account-level engagement flows, safe to sum across the period.
   *
   * `likes`/`comments`/`shares`/`saves` here are the ACCOUNT's totals for the
   * day, which is not the same as the sum of its posts': a like on a post
   * published last year counts on the day it happened, and the post grain would
   * never attribute it to this period.
   */
  totalInteractions: string;
  likes: string;
  comments: string;
  shares: string;
  saves: string;
  replies: string;

  /**
   * Distinct accounts that engaged — null unless the period is exactly one day.
   *
   * Same rule as `reach`, for the same reason: Meta measures it per day, and no
   * sum of daily distinct counts is the distinct count of the period.
   */
  accountsEngaged: string | null;
};

export type SocialOrganicAnalyticsPeriodView = {
  since: string;
  until: string;
};

/**
 * The overview response for one organic asset.
 *
 * Built field by field from aggregates, never by spreading a row — nothing
 * here carries a scope column, a stored token, or a `sync_run_id`.
 */
export type SocialOrganicAnalyticsOverviewView = {
  assetId: string;
  /** The zone whose calendar days the period was measured in. */
  timezone: string;

  period: SocialOrganicAnalyticsPeriodView;
  totals: SocialOrganicAnalyticsTotals;

  /**
   * Whether any day inside the period is still provisional (`is_partial`).
   * Scoped to this period only, matching paid's `hasPartialData`.
   */
  hasPartialData: boolean;

  /**
   * The most recent day the read model holds for this asset, anywhere — not
   * just inside the period. Null when the asset has no facts at all.
   */
  lastFactDate: string | null;
};
