import type { SocialAdProvider } from '../entities/social-ad-account-connection.entity';
import type { SocialAdBreakdownKind } from '../entities/social-ad-breakdown-daily.entity';
import type { SocialAdInsightsLevel } from './meta-ads-insights.contract';

/**
 * The Graph `breakdowns` parameter each dimension is read with.
 *
 * One entry per request, and the values are Meta's own spelling. `age,gender`
 * is a single request returning the cross of the two, which is what the
 * dashboard's grouped bar chart needs — asking for them separately would give
 * two marginal distributions that cannot be recombined into the cross.
 *
 * This is the only place the provider's vocabulary appears for a dimension, and
 * `hourly` is why that separation earns its keep: the parameter's full name
 * says the hours are cut **in the audience's timezone**, not the ad account's.
 * That is Meta's only hourly option for this edge, so it is not a choice this
 * code makes — but it does mean an hourly row's `metric_date` and its daypart
 * are measured against two different clocks, which is stated on the reader and
 * surfaced in the chart's caption rather than left for a reader to discover.
 */
export const BREAKDOWN_PARAMS: Readonly<Record<SocialAdBreakdownKind, string>> =
  {
    age_gender: 'age,gender',
    device_platform: 'device_platform',
    publisher_platform: 'publisher_platform',
    hourly: 'hourly_stats_aggregated_by_audience_time_zone',
  };

/**
 * The dimensions an ingest pass reads, in order.
 *
 * Fixed internally rather than accepted from a request, for the same reason
 * `INGEST_LEVELS` is: the list is what a pass reports having covered, and a
 * caller-supplied one would produce coverage claims describing whatever that
 * caller happened to ask for.
 *
 * `hourly` goes last because it is the most expensive of the four and a pass
 * that fails partway reports the dimensions that already landed. Measured
 * against this account's 90 days: 484 hourly rows where `age_gender` produced
 * 83 and `publisher_platform` 15. The ceiling is 24 rows per delivering day —
 * fixed, unlike the audience dimensions, which is what keeps the cost bounded.
 */
export const BREAKDOWN_KINDS: readonly SocialAdBreakdownKind[] = [
  'age_gender',
  'device_platform',
  'publisher_platform',
  'hourly',
];

/**
 * One breakdown fact, normalized, ready to be written.
 *
 * Carries its own scope, like `NormalizedAdMetricDaily` and for the same
 * reason: the writer then has a single complete argument and there is no second
 * place where a batch could be paired with the wrong tenant.
 *
 * The promoted action columns are absent here as they are on the entity. What
 * Meta reported lands whole in `actions`, and every derived number is derived on
 * read — one definition of a lead, shared with the unsplit facts.
 */
export type NormalizedAdBreakdownDaily = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
  provider: SocialAdProvider;
  entityLevel: SocialAdInsightsLevel;
  entityExternalId: string;
  /** `date_start` verbatim, as a calendar day. Never converted. */
  metricDate: string;
  accountTimezone: string;
  currency: string | null;
  breakdownKind: SocialAdBreakdownKind;
  /** Meta's own value for the dimension, lowercased and bounded. */
  breakdownKey: string;
  /** Decimal strings for `numeric`, digit strings for `bigint`. Never floats. */
  spend: string;
  impressions: string;
  clicks: string;
  linkClicks: string;
  /** Null when Meta reported none. Additive in neither direction. */
  reach: string | null;
  /** Everything Meta reported, so the mapping can be re-derived on read. */
  actions: Record<string, unknown>;
  isPartial: boolean;
  syncedAt: Date;
};

/** Rows of one dimension, plus whether the read actually saw all of them. */
export type NormalizedAdBreakdownPage = {
  rows: NormalizedAdBreakdownDaily[];
  /**
   * The provider had more pages than the ceiling allowed.
   *
   * Fatal, exactly as it is for the unsplit window, and more obviously so: a
   * truncated breakdown is a *distribution* missing some of its buckets, and
   * nothing distinguishes a bucket that was cut off from one with no delivery.
   * A pie chart drawn from it would be wrong in a way no reader could detect.
   */
  truncated: boolean;
  /** Rows dropped as unreadable. Counted, never coerced into zeros. */
  skipped: number;
  /** Graph requests this dimension actually cost. */
  apiCalls: number;
};
