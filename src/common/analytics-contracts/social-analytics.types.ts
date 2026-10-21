/**
 * The Social Analytics read contracts, mirroring what S2.7 returns.
 *
 * Every numeric field is a decimal **string**, exactly as the API sends it. The
 * columns behind them are `numeric(18,6)` and `bigint`, both of which exceed
 * what a JS number holds exactly — parsing them to `number` on arrival would
 * quietly round a quarter of ad spend and lose precision on counts above 2^53.
 * They are parsed at the moment of formatting and nowhere else.
 *
 * `null` never means zero anywhere in this file. It means the value was not
 * observed, or the KPI has no defined value because its denominator was zero.
 * The distinction is the whole reason the API is shaped this way, and the UI
 * renders it as an em dash rather than a `0`.
 */

export type SocialAdReachGranularity = "daily";

/** KPIs derived by the API. The frontend never computes these. */
export type SocialAdKpis = {
  ctr: string | null;
  cpc: string | null;
  cpm: string | null;
  cpl: string | null;
  cpa: string | null;
  roas: string | null;
  /** Cost per conversation started. Null when none were measured. */
  costPerConversation: string | null;
};

export type SocialAdAnalyticsTotals = SocialAdKpis & {
  spend: string;
  impressions: string;
  clicks: string;
  linkClicks: string;
  leads: string;
  conversions: string;
  conversionValue: string;
  videoViews: string;

  /**
   * Conversations started by the ads in the period.
   *
   * Never add this to `leads`: on a messaging campaign the two describe
   * overlapping people, so a total counts most of them twice.
   */
  messagingConversations: string | null;

  /**
   * ThruPlays — watched to the end or for at least 15 seconds.
   *
   * Null when no day in the period reported it, which includes every period
   * before the field was first requested. Roughly 5x smaller than `videoViews`
   * (the 3-second count) on real campaigns, so the two are never swapped.
   */
  thruplays: string | null;

  /** Average seconds per view, already weighted across the period. Never sum. */
  videoAvgWatchSeconds: string | null;

  /**
   * Null for any period longer than one day.
   *
   * Reach is de-duplicated people and cannot be summed across days. The API
   * deliberately withholds it rather than returning a sum, so the UI must not
   * display a period-level reach — there is no honest number to show.
   */
  reach: string | null;
  reachGranularity: SocialAdReachGranularity;

  /**
   * The reach of the whole period, de-duplicated by Meta — never a sum.
   *
   * The one number in this type the API did not aggregate from daily rows. It
   * comes from a cache of measurements taken by asking Meta for the range with no
   * `time_increment`, so the de-duplication happened where the identities are. A
   * local sum of the daily figures would be larger — up to the number of days
   * larger — because anybody reached on more than one day is counted once here
   * and once per day there.
   *
   * **Null is the expected value**, not an error, and the UI must have a state
   * for it: measurement is gated off by default on the server, and a custom range
   * nobody has measured yet has no row. The state is "alcance do período ainda
   * não medido"; there is no fallback, and summing `reach` across days to fill
   * the gap is the one thing this field exists to make unnecessary.
   *
   * On `previous` it is null far more often — only the presets are pre-measured,
   * and the window immediately preceding a preset is not one of them — so a
   * period-over-period reach comparison is usually unavailable. That is the
   * honest state; the alternative would compare a measurement against a sum.
   */
  periodReach: string | null;

  /**
   * When `periodReach` was measured, as an ISO instant. Null whenever it is.
   *
   * Belongs in the tooltip beside the figure. A reach number with no measurement
   * time is one nobody can reconcile against the Ads Manager tab open next to it
   * — and for a range that includes today it is the only thing that says how much
   * of today the number covers.
   */
  periodReachMeasuredAt: string | null;

  /**
   * Impressions per person reached. Null exactly when `periodReach` is.
   *
   * A bare multiplier: `2.5` means each reached person saw the ads two and a
   * half times. It shares `periodReach`'s denominator and therefore its
   * availability — only the preset ranges are measured.
   */
  frequency: string | null;

  /**
   * Cost per person reached, in the account's currency.
   *
   * Not CPM, which divides by a thousand impressions and so charges the same
   * person again on each view. Null under the same rule as `frequency`.
   */
  cpp: string | null;
};

/** Absolute movement, plus the percentage when a previous value existed. */
export type SocialAdChange = {
  absolute: string;
  /** Null when the previous period was zero — growth from nothing is undefined. */
  percent: string | null;
};

export type SocialAdAnalyticsChange = {
  spend: SocialAdChange;
  impressions: SocialAdChange;
  clicks: SocialAdChange;
  linkClicks: SocialAdChange;
  leads: SocialAdChange;
  conversions: SocialAdChange;
  conversionValue: SocialAdChange;
  videoViews: SocialAdChange;
};

export type SocialAdAnalyticsPeriod = {
  since: string;
  until: string;
};

export type SocialAdAnalyticsOverview = {
  connectionId: string;
  timezone: string;
  currency: string | null;
  period: SocialAdAnalyticsPeriod;
  comparisonPeriod: SocialAdAnalyticsPeriod;
  current: SocialAdAnalyticsTotals;
  previous: SocialAdAnalyticsTotals;
  change: SocialAdAnalyticsChange;

  /**
   * How many campaigns, ads and boosts the period contained.
   *
   * Counts what DELIVERED, not what the account holds: an account with 72
   * mirrored campaigns of which one ran last week reports one, because "72"
   * beside a week of spend invites the reader to divide them.
   *
   * Optional so a cached or older response renders these as unavailable rather
   * than crashing the card.
   */
  counts?: SocialAdInventoryCounts;
  /** The same counts for `comparisonPeriod`; optional on the same terms. */
  previousCounts?: SocialAdInventoryCounts;

  /**
   * Conversion events of the catalog the period recorded.
   *
   * Only events the account actually reported appear, so an account with no
   * pixel gets an empty array — which is the honest shape for "this business
   * does not have these", and the reason the UI renders nothing rather than
   * twenty empty rows.
   *
   * Optional for the same reason `counts` is: a cached response from before
   * this field existed must render as "none" rather than crash.
   */
  conversions?: SocialAdConversionTotal[];

  /**
   * Every action type the period recorded, ranked, aliases already collapsed.
   *
   * Optional for the same reason `conversions` is: a response cached before the
   * field existed still renders. Unlike `conversions`, this is normally *not*
   * empty — an account with no pixel still reports engagements and video views.
   */
  actionTypes?: SocialAdActionTypeTotal[];

  /** Whether any day inside the current period is still accumulating. */
  hasPartialData: boolean;
  lastFactDate: string | null;
};

export type SocialAdInventoryCounts = {
  campaigns: string;
  ads: string;
  boosts: string;
};

/**
 * One catalogued conversion event — a pixel, app or subscription event.
 *
 * Read from the stored action payload rather than from a promoted column, so
 * the set of these grows with the catalog and the shape stays generic. Nothing
 * here feeds `leads` or `conversions` on the totals.
 */
export type SocialAdConversionTotal = {
  id: string;
  label: string;
  group: string;
  /** Null when no alias ever appeared — never the same as `"0"`. */
  count: string | null;
  /** Money, for events that carry it and were actually priced. */
  value: string | null;
  /** Spend over count. */
  costPer: string | null;
  /**
   * Value over spend, per event.
   *
   * For `purchase` this is the site-purchase ROAS. Deliberately not the `roas`
   * on the totals, which divides the whole `conversionValue` — leads and
   * registrations included — by spend.
   */
  roas: string | null;
  /**
   * Whether this codebase has observed the event on a real account.
   *
   * False means the alias list came from Meta's documentation rather than from
   * measurement, so a missing alias would undercount silently. The UI labels
   * these rather than presenting them with the same confidence as spend.
   */
  verified: boolean;
};

/**
 * One action type the account reported, over the period.
 *
 * Distinct from `SocialAdConversionTotal`: that is a fixed catalog of commerce
 * events looked up whether or not the account has them, while this is whatever
 * the account actually reported — including types no catalog knows.
 */
export type SocialAdActionTypeTotal = {
  /** Meta's canonical type name, and the row's stable id. */
  type: string;
  /** pt-BR label, or the raw type name when nothing catalogues it. */
  label: string;
  count: string;
  /**
   * Period spend divided by this event's count, or null when nothing was spent.
   *
   * On every row, whatever the campaigns were optimised for: the money bought
   * all of these events together. The rows do not sum to the budget and are
   * not meant to — each answers what one event of that type cost, alone.
   */
  costPer: string | null;
  /**
   * Alias names folded into this row, so the collapse is visible.
   *
   * Meta reports one event under several names — `page_engagement` and
   * `post_engagement` both carried 1 036 on the measured account. Without this
   * the other names would simply be absent from a table claiming to list
   * everything.
   */
  absorbed: string[];
  /** Whether a KPI card elsewhere already shows this same event. */
  promoted: boolean;
  /** False when the type is shown by its raw name. */
  known: boolean;
};

export type SocialAdSeriesMode = "continuous";

/**
 * One calendar day.
 *
 * `hasData: false` days are present with null metrics — the series is
 * continuous. A chart must render those as gaps, never as zero: zero asserts
 * "spent nothing", while the truth is "never synced".
 */
export type SocialAdSeriesPoint = {
  date: string;
  hasData: boolean;

  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  linkClicks: string | null;
  leads: string | null;
  conversions: string | null;
  conversionValue: string | null;
  videoViews: string | null;

  /**
   * Conversations started that day.
   *
   * Unlike the two below, the history here is continuous: the column was
   * backfilled from the stored action payload when it was added.
   */
  messagingConversations: string | null;

  /** Both collected only from 2026-09-23; null on every earlier day. */
  thruplays: string | null;
  videoAvgWatchSeconds: string | null;

  /** The day's own de-duplicated reach — returnable because the grain is a day. */
  reach: string | null;

  ctr: string | null;
  cpc: string | null;
  cpm: string | null;
  cpl: string | null;
  cpa: string | null;
  roas: string | null;
  costPerConversation: string | null;

  isPartial: boolean;
};

export type SocialAdAnalyticsSeries = {
  connectionId: string;
  timezone: string;
  currency: string | null;
  period: SocialAdAnalyticsPeriod;
  seriesMode: SocialAdSeriesMode;
  points: SocialAdSeriesPoint[];
  observedDays: number;
  hasPartialData: boolean;
};

export const SOCIAL_CAMPAIGN_SORTS = [
  "spend",
  "impressions",
  "clicks",
  "leads",
  "conversions",
  "ctr",
  "cpc",
  "cpl",
  "roas",
  "name",
] as const;

export type SocialAdCampaignSort = (typeof SOCIAL_CAMPAIGN_SORTS)[number];
export type SocialAdSortDirection = "asc" | "desc";

export type SocialAdCampaignRow = SocialAdKpis & {
  externalId: string;

  /**
   * Nullable throughout: facts and the hierarchy mirror are separate reads that
   * can disagree for minutes. A campaign whose spend arrived before its name
   * still appears, because dropping it would understate the account's total.
   */
  name: string | null;
  status: string | null;
  effectiveStatus: string | null;
  objective: string | null;
  archived: boolean;

  spend: string;
  impressions: string;
  clicks: string;
  linkClicks: string;
  leads: string;
  conversions: string;
  conversionValue: string;
  videoViews: string;
  reach: string | null;
  hasPartialData: boolean;
};

export type SocialAdAnalyticsCampaigns = {
  connectionId: string;
  timezone: string;
  currency: string | null;
  period: SocialAdAnalyticsPeriod;
  sort: SocialAdCampaignSort;
  direction: SocialAdSortDirection;
  items: SocialAdCampaignRow[];
  total: number;
};

/**
 * Ad-set sorts. The same closed set as campaigns — the endpoint mirrors
 * `campaigns()` line for line, including its fixed lookup of sort expressions.
 */
export const SOCIAL_AD_SET_SORTS = SOCIAL_CAMPAIGN_SORTS;

export type SocialAdAdSetSort = (typeof SOCIAL_AD_SET_SORTS)[number];

/**
 * One ad set's totals for the period — `GET social/analytics/ad-sets`.
 *
 * The endpoint has existed since the Etapa 4 extension with no client in front
 * of it; Etapa 8 is what consumes it, as the second source a table card can be
 * pointed at.
 *
 * `optimizationGoal`, `billingEvent` and `destinationType` are meaningful at
 * this level only: Meta states them on the ad set and they are never inherited
 * from the campaign, which is why they have no counterpart on `SocialAdCampaignRow`.
 */
export type SocialAdAdSetRow = SocialAdKpis & {
  externalId: string;
  /** The parent campaign, denormalised onto every ad-set fact. */
  campaignExternalId: string | null;
  name: string | null;
  status: string | null;
  effectiveStatus: string | null;
  optimizationGoal: string | null;
  billingEvent: string | null;
  destinationType: string | null;
  archived: boolean;

  spend: string;
  impressions: string;
  clicks: string;
  linkClicks: string;
  leads: string;
  conversions: string;
  conversionValue: string;
  videoViews: string;
  /** Null for any period longer than a day. Reach is never summed. */
  reach: string | null;
  hasPartialData: boolean;
};

export type SocialAdAnalyticsAdSets = {
  connectionId: string;
  timezone: string;
  currency: string | null;
  period: SocialAdAnalyticsPeriod;
  sort: SocialAdAdSetSort;
  direction: SocialAdSortDirection;
  items: SocialAdAdSetRow[];
  total: number;
};

/**
 * Ad sorts. The same closed set again — the endpoint mirrors `ad-sets` line for
 * line, including its fixed lookup of sort expressions.
 */
export const SOCIAL_AD_SORTS = SOCIAL_CAMPAIGN_SORTS;

export type SocialAdAdSort = (typeof SOCIAL_AD_SORTS)[number];

/**
 * One ad's totals for the period — `GET social/analytics/ads`.
 *
 * The finest grain the facts table holds, and the only one at which "which
 * creative worked" can be answered: one ad set routinely runs several ads
 * against one audience on one budget, so dividing its spend between them would
 * be an estimate rather than a measurement.
 */
export type SocialAdAdRow = SocialAdKpis & {
  externalId: string;
  /** The parent campaign, denormalised onto every ad fact. */
  campaignExternalId: string | null;
  /**
   * The ad set, from the hierarchy mirror rather than from the fact — null
   * until the mirror has seen the ad.
   */
  adSetExternalId: string | null;
  name: string | null;
  status: string | null;
  effectiveStatus: string | null;
  /**
   * The creative this ad renders, by id — **never a URL**.
   *
   * Meta signs its thumbnail links with an expiry of about five days, so none
   * is ever stored or sent here. The picture is a separate, authenticated
   * request per row: `socialAnalyticsApi.adThumbnail`. Null renders a
   * placeholder, which is the right outcome for a row about numbers.
   */
  creativeId: string | null;
  archived: boolean;

  spend: string;
  impressions: string;
  clicks: string;
  linkClicks: string;
  leads: string;
  conversions: string;
  conversionValue: string;
  videoViews: string;
  /** Null for any period longer than a day. Reach is never summed. */
  reach: string | null;
  hasPartialData: boolean;
};

export type SocialAdAnalyticsAds = {
  connectionId: string;
  timezone: string;
  currency: string | null;
  period: SocialAdAnalyticsPeriod;
  sort: SocialAdAdSort;
  direction: SocialAdSortDirection;
  items: SocialAdAdRow[];
  total: number;
};

export type SocialAdBackfillChainStatus =
  | "not_started"
  | "in_progress"
  | "stalled"
  | "complete";

export type SocialAdBackfillFreshness = {
  status: SocialAdBackfillChainStatus;
  /** The chain's original anchor, never recalculated from today. */
  anchor: string | null;
  chunksTotal: number;
  chunksSucceeded: number;
  chunksInFlight: number;
  stalled: boolean;
  complete: boolean;
};

export type SocialAdMetricsFreshness = {
  latestMetricDate: string | null;
  latestClosedMetricDate: string | null;
  latestPartialMetricDate: string | null;
  latestMetricsSyncedAt: string | null;
};

export type SocialAdRunFreshness = {
  latestSuccessfulDailyRun: string | null;
  latestSuccessfulIntradayRun: string | null;
};

export type SocialAdAnalyticsFreshness = {
  connectionId: string;
  timezone: string;
  connectionStatus: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  metrics: SocialAdMetricsFreshness;
  runs: SocialAdRunFreshness;
  backfill: SocialAdBackfillFreshness;
  hasPartialData: boolean;
};

/**
 * The connection shape the analytics picker receives.
 *
 * Strictly narrower than the settings screen's: no credential state, no token
 * expiry, no scopes, no raw account id. It is served by
 * `GET /social/analytics/connections` under the operational read permission,
 * which is why it may not carry any of those.
 */
export type SocialAdAnalyticsConnection = {
  id: string;
  provider: "meta_ads" | "google_ads";
  connectionStatus: string;
  accountName: string | null;
  maskedAccountId: string | null;
  currency: string | null;
  timezone: string | null;
  lastSyncedAt: string | null;
};

export type SocialAdAnalyticsConnectionsResponse = {
  items: SocialAdAnalyticsConnection[];
  total: number;
};

/** Organic values preserve the API's bigint-as-string contract. */
export type SocialOrganicAnalyticsAsset = {
  id: string;
  provider: string;
  assetType: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  status: string;
  assetTimezone: string | null;
};

export type SocialOrganicAnalyticsAssetsResponse = {
  items: SocialOrganicAnalyticsAsset[];
  total: number;
};

export type SocialOrganicAnalyticsTotals = {
  impressions: string;
  /**
   * Instagram feed and every Page post (`feed`), Instagram reels (`reel`).
   * Optional so a cached response from before the fields reads as missing.
   */
  feedInteractions?: SocialOrganicInteractionSums;
  reelInteractions?: SocialOrganicInteractionSums;
  /** Null outside a one-day window; daily reach is not additive. */
  reach: string | null;
  reachGranularity: "daily";

  /**
   * The de-duplicated reach of the whole period, measured by Meta.
   *
   * What the card shows. `reach` above is the daily grain and is null for every
   * real reporting window; this is one measurement of the range, so Meta
   * removed the people who appeared on more than one day.
   *
   * **Includes ads** — Meta only collapses reach to a period figure when
   * nothing breaks it down, and the breakdown is what isolates organic
   * surfaces. Null for a custom range nobody measured, and on Facebook, whose
   * Page equivalent Meta retired.
   */
  periodReach: string | null;
  periodReachIncludesAds: boolean;

  /**
   * The same measured window, split the way Meta splits it.
   *
   * **The three do not add up.** Verified against production: 156 organic plus
   * 6 645 paid against a total of 6 783. An account reached both organically
   * and by an ad is one account in the total and one in each slice, so the
   * excess is the overlap Meta removed from the total.
   *
   * A card may show all three side by side and must not draw them as parts of
   * one bar or state either as a share of the total. Null means the window
   * carries no breakdown — not that nothing was paid.
   */
  periodReachOrganic: string | null;
  periodReachPaid: string | null;

  /** Total views of the window, ads included; slices on the same terms. */
  periodViews: string | null;
  periodViewsOrganic: string | null;
  periodViewsPaid: string | null;

  /**
   * Reach of feed posts alone — Meta's "Alcance das postagens".
   *
   * A subset of `periodReachOrganic`: reels and stories are organic too, so the
   * two are never added. Comes from Meta's own breakdown rather than from
   * summing per-post reach, which would count a follower who saw three posts
   * three times.
   */
  periodFeedReach: string | null;

  /**
   * The same measurement for reels and for stories.
   *
   * Each is a subset of the organic slice and the three surfaces do not
   * partition it — Meta de-duplicates within each, so somebody who saw a story
   * and a reel counts once in the organic total and once in each of these. A
   * card must never add them or present one as a share of another.
   */
  periodReelReach: string | null;
  periodStoryReach: string | null;
  periodFeedViews: string | null;
  periodReelViews: string | null;
  periodStoryViews: string | null;

  /**
   * Engagement for the window, by surface.
   *
   * Ordinary additive counters, unlike reach — but still measured by Meta
   * rather than summed from the posts table, because that table only holds
   * content a sync caught and holds no expired story at all.
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
   * Counted rather than measured, so a real `"0"` rather than null when the
   * account published nothing. `periodStoryCount` is a floor: a story posted
   * and expired between two hourly captures was never recorded, and unlike
   * every other figure here that gap can never be filled.
   */
  /** Posts published in the window, every surface. Not reels + Page posts. */
  publications: string;
  periodReelCount: string;
  periodStoryCount: string;

  /**
   * The Facebook Page figures. Null or `"0"` on an Instagram asset.
   *
   * There is no `pageReach`, and the absence is deliberate: Meta retired every
   * unique-audience metric a Page reported, so a Page cannot say how many
   * people it reached and the dashboard offers no card claiming otherwise. The
   * one place unique viewers survive on the Facebook side is a reel.
   *
   * `pageViews` is measured for the window and may be null. The rest are summed
   * or counted from stored rows, so `"0"` is a real answer there.
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
   * `pageReelViewers` overstates, knowingly: Meta reports unique viewers per
   * reel and offers no de-duplicated union, so someone who watched two reels is
   * counted twice. It is kept because it is the only unique-viewer figure left
   * anywhere on the Facebook side, and the card says what it is.
   */
  pageReelPlays: string;
  pageReelViewers: string;
  pageReelWatchTimeSeconds: string;
  pageReelReactions: string;
  pageReelComments: string;
  pageReelShares: string;

  /**
   * The range the period figures above actually describe.
   *
   * Meta refuses a window wider than 30 days, so a longer request is measured
   * over its last 30 and `periodTruncated` says so. A card labels itself from
   * these rather than from the period the user picked.
   */
  periodMeasuredSince: string | null;
  periodMeasuredUntil: string | null;
  periodTruncated: boolean;

  followersCount: string | null;
  followersGained: string;
  followersLost: string;
  profileViews: string;

  /** Daily flows, collected in the same call as `profileViews`. */
  totalInteractions: string;
  likes: string;
  comments: string;
  shares: string;
  saves: string;
  replies: string;

  /**
   * Distinct accounts that interacted — null unless the period is one day.
   *
   * Same rule as `reach`: measured per day, and no sum of daily distinct counts
   * is the period's distinct count.
   */
  accountsEngaged: string | null;
};

/**
 * One surface's views and interactions: the lifetime counters of the posts
 * published in the window, summed. Null when no post of the window carried the
 * column (not collected); zeros when nothing was published.
 */
export type SocialOrganicInteractionSums = {
  publications: string;
  views: string | null;
  likes: string | null;
  comments: string | null;
  shares: string | null;
  saves: string | null;
};

export type SocialOrganicAnalyticsOverview = {
  assetId: string;
  timezone: string;
  period: SocialAdAnalyticsPeriod;
  totals: SocialOrganicAnalyticsTotals;
  /**
   * The window of the same length before `period`, and its totals on the same
   * rules. Optional so a cached response from before the fields existed shows
   * no comparison rather than crashing. Period measurements are usually null
   * here (only presets are pre-measured) and `followersCount` always is.
   */
  comparisonPeriod?: SocialAdAnalyticsPeriod;
  previousTotals?: SocialOrganicAnalyticsTotals;
  hasPartialData: boolean;
  lastFactDate: string | null;
};

export type SocialOrganicAnalyticsSeriesPoint = {
  date: string;
  hasData: boolean;
  impressions: string | null;
  reach: string | null;
  followersCount: string | null;
  followersGained: string | null;
  followersLost: string | null;
  profileViews: string | null;
  totalInteractions: string | null;
  likes: string | null;
  comments: string | null;
  shares: string | null;
  saves: string | null;
  replies: string | null;
  /**
   * Distinct accounts engaged on this day.
   *
   * Present per point although the period total withholds it: the grain of a
   * point is the day Meta counted the distinct accounts at, so a series can
   * show it honestly where a sum could not.
   */
  accountsEngaged: string | null;
  /**
   * A Facebook Page's follower level on this day. Null for Instagram.
   *
   * The field a growth chart must use — `followersCount` above cannot serve,
   * because the sync writes the current level onto whichever day it is
   * syncing, so every historical point carries today's number and the line is
   * flat and wrong rather than visibly missing.
   */
  pageFollows: string | null;
  pageDailyFollows: string | null;
  pageDailyUnfollows: string | null;
  /** Both halves of the Page's organic/paid view split. Null for Instagram. */
  viewsOrganic: string | null;
  viewsPaid: string | null;
  /** Messenger threads opened by a first-time sender. Null for Instagram. */
  newConversations: string | null;
  isPartial: boolean;
};

/** One weekday's publishing performance — the "melhor dia" card. */
export type SocialOrganicWeekdayBucket = {
  /** ISO-8601: 1 = Monday … 7 = Sunday. */
  weekday: number;
  publications: number;
  total: string | null;
  /** Views per publication. Null when nothing was published that weekday. */
  average: string | null;
};

export type SocialOrganicWeekdayView = {
  assetId: string;
  timezone: string;
  period: { since: string; until: string };
  /** Always seven entries, Monday first. */
  buckets: SocialOrganicWeekdayBucket[];
  /**
   * The best weekday, or null when too little was published to name one.
   *
   * Null is a real answer and the card renders it as such: naming a best day
   * from two posts is a coin toss that an operator would act on.
   */
  bestWeekday: number | null;
};

export type SocialOrganicAnalyticsSeries = {
  assetId: string;
  timezone: string;
  period: SocialAdAnalyticsPeriod;
  seriesMode: "continuous";
  points: SocialOrganicAnalyticsSeriesPoint[];
  observedDays: number;
  hasPartialData: boolean;
};

export type SocialOrganicAnalyticsFreshness = {
  assetId: string;
  timezone: string;
  metrics: {
    latestMetricDate: string | null;
    latestClosedMetricDate: string | null;
    latestPartialMetricDate: string | null;
    latestMetricsSyncedAt: string | null;
  };
  runs: {
    latestSuccessfulScheduledRun: string | null;
    latestSuccessfulManualRun: string | null;
  };
  hasPartialData: boolean;
};

/**
 * The four dimensions the paid breakdown ingest can be asked for.
 *
 * `hourly` is the daypart dimension, and the one whose buckets are cut in the
 * **viewer's** timezone rather than the ad account's — Meta's only hourly
 * option for this edge. It is also the only one with a fixed bucket count: 24,
 * always, where the audience dimensions grow as Meta adds platforms.
 */
export type SocialAdBreakdownKind =
  | "age_gender"
  | "device_platform"
  | "publisher_platform"
  | "hourly";

/**
 * One bucket's additive totals over the window.
 *
 * `reach` is always `null` here — it is not an omission. Reach does not sum
 * across days (the same person on two days is one person) and it does not sum
 * across buckets of one day either (someone reached on mobile and on desktop
 * counts in both). There is no honest period figure at bucket grain.
 */
export type SocialAdBreakdownBucket = {
  key: string;
  label: string;
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  linkClicks: string | null;
  reach: null;
};

/**
 * One dimension's distribution over a window.
 *
 * `hasData: false` must not be read as "no audience" — the ingest is gated off
 * by default, so an empty distribution is the *expected* state on most
 * deployments. `coveredDays` vs `expectedDays` is what tells the two apart from
 * "ingestion ran but there was nothing to report".
 */
export type SocialAdBreakdownView = {
  kind: SocialAdBreakdownKind;
  since: string;
  until: string;
  timezone: string;
  currency: string | null;
  hasData: boolean;
  coveredDays: number;
  expectedDays: number;
  buckets: SocialAdBreakdownBucket[];
};

/** The five dimensions the organic audience snapshot (Etapa 2A) can be asked for. */
export type SocialOrganicAudienceKind =
  | "age_gender"
  | "gender"
  | "age"
  | "city"
  | "country";

export type SocialOrganicAudienceBucket = {
  key: string;
  label: string;
  /** A lifetime snapshot value, never a flow — do not sum across buckets to get a total that means "more than the account has". */
  value: string;
};

/**
 * A follower-demographics snapshot, always the newest available day.
 *
 * There is no period here by design — see the read service. `asOf` is the day
 * the snapshot was taken; a caller comparing it against the dashboard's own
 * period is comparing a stock to a flow, which is expected and not a bug.
 */
export type SocialOrganicAudienceView = {
  kind: SocialOrganicAudienceKind;
  /** Null when there is no snapshot at all yet. */
  asOf: string | null;
  timezone: string;
  hasData: boolean;
  buckets: SocialOrganicAudienceBucket[];
};

/** One hour of "melhor horário para postagens". */
export type SocialOrganicActivityHourPoint = {
  /** 0–23, already converted into the asset's own timezone. */
  hour: number;
  /** Mean followers online in that hour, as a decimal string. */
  average: string;
  /** Days that contributed; 0 means the hour has no sample, not a quiet hour. */
  sampleDays: number;
};

/** One weekday of "melhor dia para postagem". */
export type SocialOrganicActivityWeekdayPoint = {
  /** 0 = Sunday, matching `Date.getDay`, in the asset's own timezone. */
  weekday: number;
  average: string;
  sampleDays: number;
};

/**
 * When this account's followers are online.
 *
 * Both charts come from one grid: the best hour is it read down the columns,
 * the best weekday across the rows.
 *
 * ## The window is Meta's, not the dashboard's
 *
 * Meta serves roughly the last 30 days of this metric whatever period the
 * report asks for, so there is no period parameter and `windowSince`/
 * `windowUntil` state what was actually averaged. A chart labels itself from
 * those rather than inheriting the dashboard's heading.
 *
 * ## Every figure is a mean
 *
 * The underlying counts are a stock — a follower online at 14h and 15h is one
 * person in two rows — so sums are meaningless and only comparisons between
 * hours or weekdays are supported.
 *
 * `hours` always has 24 entries and `weekdays` always 7, so a chart can draw
 * its axis without inventing positions for missing keys.
 */
export type SocialOrganicActivityView = {
  assetId: string;
  /** The zone the hours and weekdays are expressed in. */
  timezone: string;
  /** The zone Meta indexed them in before conversion — Pacific. */
  sourceTimezone: string;
  windowSince: string | null;
  windowUntil: string | null;
  daysCovered: number;
  /** False before anything is collected — distinct from an all-zero grid. */
  hasData: boolean;
  hours: SocialOrganicActivityHourPoint[];
  weekdays: SocialOrganicActivityWeekdayPoint[];
};

export type SocialConsolidatedAnalyticsOverview = {
  period: SocialAdAnalyticsPeriod;
  paid: {
    connectionId: string;
    timezone: string;
    currency: string | null;
    totals: SocialAdAnalyticsTotals;
    hasPartialData: boolean;
    lastFactDate: string | null;
  };
  organic: {
    assetId: string;
    timezone: string;
    totals: SocialOrganicAnalyticsTotals;
    hasPartialData: boolean;
    lastFactDate: string | null;
  };
};

/**
 * One post in the "best posts" ranking.
 *
 * Every counter is a **lifetime total** — cumulative since the post was
 * published — which is why the row carries `observedAt` instead of a period,
 * and why none of these values may be added together across posts.
 *
 * No image URL: Meta signs those with a ~5 day expiry, so the picture is
 * fetched from the backend's thumbnail endpoint keyed by
 * `externalPublicationId`. `permalink` is the stable link.
 */
export type SocialOrganicTopPost = {
  externalPublicationId: string;
  publicationId: string | null;
  assetId: string;
  permalink: string | null;
  caption: string | null;
  mediaType: string | null;
  mediaProductType: string | null;
  publishedAt: string | null;
  observedAt: string | null;
  reach: string | null;
  impressions: string | null;
  likes: string | null;
  comments: string | null;
  saves: string | null;
  shares: string | null;
  totalInteractions: string | null;
  /**
   * Feed posts only. Meta refuses these two for a reel — and refuses the whole
   * request along with them, which is why the backend asks each surface for its
   * own metric list. Null on a reel means "this surface does not report it",
   * not zero.
   */
  profileVisits: string | null;
  follows: string | null;
  /**
   * Reels only, null on every other surface.
   *
   * `reelsSkipRateBp` is a percentage in **basis points** (66.1% → 6610), not a
   * counter; the watch times are milliseconds.
   */
  reelsAvgWatchTimeMs: string | null;
  reelsTotalWatchTimeMs: string | null;
  reelsSkipRateBp: string | null;
  reposts: string | null;
  /**
   * Reactions by type — Facebook only, null on every Instagram row.
   *
   * Instagram has one reaction and it is already `likes`. Null rather than zero
   * there, so a table can tell "this surface has no reactions" from "nobody
   * reacted".
   */
  reactionsTotal: string | null;
  reactionsLike: string | null;
  reactionsLove: string | null;
  reactionsWow: string | null;
  reactionsHaha: string | null;
  reactionsSorry: string | null;
  reactionsAnger: string | null;
  /**
   * `post_media_view` split by whether an ad served it — Facebook only.
   *
   * These two do partition the total, unlike Instagram's de-duplicated surface
   * slices: a view came from an ad or it did not.
   */
  viewsOrganic: string | null;
  viewsPaid: string | null;
};

/**
 * One Facebook Page reel.
 *
 * A separate shape from `SocialOrganicTopPost` because it is a separate
 * measurement, not a separate spelling: a Facebook reel reports plays, replays
 * and unique viewers where an Instagram one reports views, reach and saves. A
 * play counts a start and a view counts a threshold, so one field holding
 * either would invite a comparison that means nothing.
 */
export type SocialOrganicFacebookReel = {
  externalPublicationId: string;
  assetId: string;
  publishedAt: string | null;
  description: string | null;
  permalink: string | null;
  /** A signed CDN URL that may already have expired. */
  thumbnailUrl: string | null;
  lengthSeconds: string | null;
  /** Every start, including replays by the same person. */
  plays: string | null;
  blueReelsPlays: string | null;
  replays: string | null;
  /**
   * Accounts that saw the reel at least once.
   *
   * A stock, never summed across reels: two reels seen by 100 accounts each
   * were not seen by 200, and Meta offers no de-duplicated union.
   */
  uniqueViewers: string | null;
  totalWatchTimeMs: string | null;
  /** Already a mean; not averageable across reels without weighting by plays. */
  avgWatchTimeMs: string | null;
  reactionsTotal: string | null;
  reactionsLike: string | null;
  reactionsLove: string | null;
  reactionsWow: string | null;
  reactionsHaha: string | null;
  reactionsSorry: string | null;
  reactionsAnger: string | null;
  comments: string | null;
  shares: string | null;
  newFollowers: string | null;
  /**
   * The share still watching at each second, in Meta's own shape:
   * `{"0": 0.9822, "1": 0.9841, ...}`. One key per second of the reel.
   */
  retentionGraph: Record<string, number> | null;
  observedAt: string | null;
};

export type SocialOrganicFacebookReelsView = {
  items: SocialOrganicFacebookReel[];
  total: number;
};

export type SocialOrganicFacebookReelSort =
  | "plays"
  | "uniqueViewers"
  | "totalWatchTimeMs"
  | "avgWatchTimeMs"
  | "reactionsTotal"
  | "comments"
  | "shares"
  | "publishedAt";

export type SocialOrganicTopPostsView = {
  items: SocialOrganicTopPost[];
  total: number;
};

/**
 * One story in the "Stories em destaque" panel.
 *
 * Rendered as a creative beside its figures rather than as a table row, because
 * a story has retention counters no other surface has and no caption or ranking
 * depth to fill a table with.
 *
 * `mediaUrl` is best-effort and will often be null: Meta signs media URLs with
 * a ~5 day expiry while the story itself is gone after one day, and unlike a
 * feed post there is nothing left to re-resolve it from. The absence is
 * ordinary, not an error.
 */
export type SocialOrganicTopStory = {
  externalPublicationId: string;
  assetId: string;
  publishedAt: string | null;
  mediaType: string | null;
  permalink: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  views: string | null;
  reach: string | null;
  totalInteractions: string | null;
  profileVisits: string | null;
  replies: string | null;
  shares: string | null;
  /**
   * Retention, from Meta's `story_navigation_action_type` breakdown. Expected
   * null on stories captured before Meta's support for it could be verified.
   */
  navForward: string | null;
  navNextStory: string | null;
  navBack: string | null;
  navExit: string | null;
  observedAt: string | null;
};

export type SocialOrganicTopStoriesView = {
  items: SocialOrganicTopStory[];
  total: number;
};

export type SocialOrganicTopStorySort =
  | "views"
  | "reach"
  | "totalInteractions"
  | "replies"
  | "shares"
  | "publishedAt";

/**
 * Which surface a ranking is narrowed to, or every surface when omitted.
 *
 * Lyra's vocabulary, not Meta's: the provider spells the same surface several
 * ways (`REEL` and `REELS`, `FEED` and `POST` and `CAROUSEL_CONTAINER`) and the
 * backend maps them, so the client never has to know which endpoint wrote a row.
 */
export type SocialOrganicPostSurface = "feed" | "reel" | "story";

export type SocialOrganicTopPostSort =
  | "reach"
  | "impressions"
  | "likes"
  | "comments"
  | "saves"
  | "shares"
  | "totalInteractions"
  | "profileVisits"
  | "follows"
  // Facebook only. Sorting an Instagram ranking by it ties every row, which the
  // endpoint resolves by publish date — an empty column cannot order anything.
  | "reactionsTotal"
  | "publishedAt";
