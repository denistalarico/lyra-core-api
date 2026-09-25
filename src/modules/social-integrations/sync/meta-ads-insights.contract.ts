import type { SocialAdProvider } from '../entities/social-ad-account-connection.entity';
import type { SocialAdEntityLevel } from '../entities/social-ad-entity.entity';
import type {
  SocialAdAttributionSetting,
  SocialAdMetricSource,
} from '../entities/social-ad-metric-daily.entity';

/**
 * The levels this pipeline reads.
 *
 * Ad set joined in I3.4 under the rule *the smallest grain that answers a
 * question we actually have*: paid media destination — WhatsApp, Instagram
 * Direct, Messenger, a website — is a property of the **ad set**
 * (`destination_type`), so without ad-set insights the only way to report spend
 * per destination is to apportion a campaign's money across ad sets that may
 * not share a destination. That is not a measurement, it is an estimate
 * presented as one.
 *
 * `ad` joined under the same rule, and the question is *which creative worked*.
 * It is the only level at which that can be answered: one ad set routinely runs
 * several ads against one audience with one budget, and splitting the ad set's
 * spend between them would once again be an estimate wearing a measurement's
 * clothes.
 *
 * It was left out until now on a cost estimate that measurement did not
 * support. The fear was that the row count multiplied with the object count —
 * this account mirrors 260 ads against 128 ad sets. What it actually multiplies
 * with is *delivery*: Meta returns no row for an object that did not deliver on
 * a day, and over this account's last 90 days the ad level returned 73 daily
 * rows in a single paginated request. Over the last 14 days it returned 3, from
 * 3 distinct ads, against the ad set level's 2. The ceiling that matters is
 * concurrently delivering ads, not ads that exist.
 */
export type SocialAdInsightsLevel = Extract<
  SocialAdEntityLevel,
  'account' | 'campaign' | 'adset' | 'ad'
>;

/**
 * One daily fact, normalized, ready to be written.
 *
 * Same reason the hierarchy has its own contract: a Graph payload must never
 * reach TypeORM. Insights answers are looser than the hierarchy's — money and
 * counts arrive as strings, `reach` is simply absent on rows that have none,
 * and the numbers that matter most (leads, conversions) are not fields at all
 * but entries in a nested array that names the same event up to seven ways.
 * Deciding all of that inside the writer would mean deciding it while building
 * SQL, where a mistake is a stored number.
 *
 * Unlike the hierarchy's contract this one carries its own scope. A fact is
 * identified by eight columns, five of them scope; keeping them on the row
 * means the writer has a single argument that is already complete, and there is
 * no second place where a batch could be paired with the wrong tenant.
 */
export type NormalizedAdMetricDaily = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
  provider: SocialAdProvider;
  source: SocialAdMetricSource;
  entityLevel: SocialAdInsightsLevel;
  /**
   * `act_<digits>` at account level, the campaign id at campaign level, the ad
   * set id at ad set level. Always the id of the object the row *is about*.
   */
  entityExternalId: string;
  /**
   * The campaign this row rolls up into, or null at account level.
   *
   * At ad set level it is the parent campaign rather than the row's own object,
   * which is what makes `IDX_social_ad_metrics_daily_campaign` able to answer
   * "this campaign's ad sets" without a join. It is never the identity — that
   * is `entityExternalId` — and the two differ at exactly this level.
   */
  campaignExternalId: string | null;
  /**
   * `date_start` verbatim, as a calendar day.
   *
   * Never converted. Meta reports the day in the ad account's own timezone, so
   * parsing it into an instant and formatting it back would shift the whole
   * window by a day for any account east of the server — silently, and only
   * for the accounts furthest from UTC.
   */
  metricDate: string;
  /** The zone that defined the day boundary above, stored with the fact. */
  accountTimezone: string;
  currency: string | null;
  attributionSetting: SocialAdAttributionSetting;
  /** Decimal strings for `numeric`, digit strings for `bigint`. Never floats. */
  spend: string;
  impressions: string;
  /** Null when Meta reported none. Non-additive across days. */
  reach: string | null;
  clicks: string;
  linkClicks: string;
  leads: string;
  conversions: string;
  conversionValue: string;
  videoViews: string;
  /**
   * Conversations started by the ad, or null when none were reported.
   *
   * Null rather than `'0'`, like `thruplays` below: the column was added after
   * rows existed, so a zero would be indistinguishable from a row collected
   * before the field was derived at all. Not a component of `leads` or
   * `conversions` — see the entity for why summing them double counts.
   */
  messagingConversations: string | null;
  /**
   * ThruPlays: watched to the end, or for at least 15 seconds.
   *
   * Null, never `'0'`, when Meta did not report the field — the column it
   * writes to has no default for the same reason. A zero here would claim we
   * asked and the answer was none, which is indistinguishable on a chart from
   * a row collected before the field was requested at all.
   *
   * **Not interchangeable with `videoViews`.** That is the three-second
   * `video_view` action; on this account the same campaign over the same 90
   * days reported 872 of those and 190 ThruPlays.
   */
  thruplays: string | null;
  /**
   * AVERAGE seconds watched per view — `video_avg_time_watched_actions`.
   *
   * An average, not a total, which makes it the one video number here that
   * must never be summed across days or across entities: the mean of two means
   * is not the mean of the pool unless both had the same view count. A period
   * figure needs a view-weighted average, which the read layer computes; there
   * is no stored total watch time to recover it from, because Meta does not
   * offer one on this edge.
   *
   * Null when unreported, for the same reason as `thruplays`.
   */
  videoAvgWatchSeconds: string | null;
  /** Everything Meta reported, so the mapping above can be re-derived. */
  actions: Record<string, unknown>;
  /**
   * Whether the day was still open when the row was collected.
   *
   * Always `false` in this slice, and that is a statement about the endpoint
   * rather than a placeholder: a manual call names a closed window explicitly,
   * so every row it writes is a settled day. It describes the row, not the run
   * — a level that failed elsewhere does not make these facts partial.
   */
  isPartial: boolean;
  syncedAt: Date;
};

/** Rows of one level, plus whether the read actually saw all of them. */
export type NormalizedAdMetricPage = {
  rows: NormalizedAdMetricDaily[];
  /**
   * The provider had more pages than the ceiling allowed.
   *
   * Fatal here, unlike in the hierarchy sync. A truncated hierarchy is a mirror
   * missing some objects; a truncated window is a *date range* missing some of
   * its days, and writing it would leave gaps that look exactly like days with
   * no spend. There is no flag on the row that could say otherwise, so the run
   * refuses instead.
   */
  truncated: boolean;
  /** Rows dropped as unreadable. Counted, never coerced into zeros. */
  skipped: number;
  /** Graph requests this level actually cost. */
  apiCalls: number;
};
