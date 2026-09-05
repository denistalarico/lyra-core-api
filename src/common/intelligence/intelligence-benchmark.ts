import type { BenchmarkCohort } from './intelligence-benchmark-cohort';

/**
 * The shared benchmark contract: what may be asked, and what comes back.
 *
 * Types and pure functions, like the rest of this folder. The privacy rules it
 * encodes are not enforced *here* — the projector and the endpoint enforce them
 * — but the shapes are chosen so that a violation is hard to express. There is
 * no `tenantId` field to filter on, no `excludeTenant`, no free `from`/`until`,
 * and no place to put a contributor identifier. §17 is largely implemented by
 * what this file omits.
 */

/**
 * The metrics a benchmark can be asked for.
 *
 * Phase A only: Social paid media aggregates with a stable, versioned
 * definition. Every key is prefixed `paid_` and monetary keys carry their unit
 * in the name, because these strings are stored in `metric_key` and read back
 * months later — a bare `spend` in a row would not say whether it was reais or
 * centavos, and by the time anyone asked, the contributor's currency context
 * would be a join away.
 *
 * ## Why `paid_provider_leads` is included
 *
 * The decisions admit it "SOMENTE se a auditoria confirmar definição/
 * versionamento suficientemente estáveis". It qualifies, narrowly:
 * `social_ad_metrics_daily.leads` is the output of S2.4's action-family
 * de-duplication, whose rule is documented, versioned and covered by specs — one
 * lead reported under seven Meta action-type names counts once. That is a
 * defensible cross-tenant definition.
 *
 * What it is *not* is a count of conversations. The five
 * `onsite_conversion.messaging_*` action types are deliberately excluded from
 * this column (`UNCOUNTED_MESSAGING_ACTION_TYPES`), so a messaging-objective
 * advertiser contributes `0` here while genuinely receiving conversations. Two
 * consequences, both stated in `limitation` below and both load-bearing: a
 * cohort mixing messaging and lead-form advertisers benchmarks a mix of real
 * zeros and real leads, and `unit: 'count'` must never be read as "leads the
 * business received".
 *
 * ## Why reach is absent
 *
 * `reach` is non-additive — Meta de-duplicates people within a day, so two days
 * of reach share an unknown number of the same people. A contributor's window
 * value would have to be a sum, and that sum is not a measurement of anything.
 * §16 excludes it and there is no correct way to include it without a
 * period-level reach this platform never requested.
 */
export type BenchmarkMetricKey =
  | 'paid_spend_minor_units'
  | 'paid_impressions'
  | 'paid_clicks'
  | 'paid_link_clicks'
  | 'paid_provider_leads';

export type BenchmarkMetricDescriptor = {
  key: BenchmarkMetricKey;
  /** Which column of `social_ad_metrics_daily` the contribution sums. */
  source: string;
  unit: 'count' | 'currency_minor_units';
  /** Whether the cohort must be split by currency for this metric. */
  requiresCurrency: boolean;
  /** Version of the metric's *definition*, surfaced in provenance. */
  definitionVersion: string;
  limitation?: string;
};

export const BENCHMARK_METRICS: readonly BenchmarkMetricDescriptor[] = [
  {
    key: 'paid_spend_minor_units',
    source: 'social_ad_metrics_daily.spend',
    unit: 'currency_minor_units',
    requiresCurrency: true,
    definitionVersion: 'i6.paid_spend.v1',
    limitation:
      'Integer minor units of the cohort currency, never a major-unit amount. ' +
      'No FX is applied: cohorts in different currencies are different cohorts.',
  },
  {
    key: 'paid_impressions',
    source: 'social_ad_metrics_daily.impressions',
    unit: 'count',
    requiresCurrency: false,
    definitionVersion: 'i6.paid_impressions.v1',
  },
  {
    key: 'paid_clicks',
    source: 'social_ad_metrics_daily.clicks',
    unit: 'count',
    requiresCurrency: false,
    definitionVersion: 'i6.paid_clicks.v1',
    limitation: 'All clicks, matching Meta’s own definition — not link clicks.',
  },
  {
    key: 'paid_link_clicks',
    source: 'social_ad_metrics_daily.link_clicks',
    unit: 'count',
    requiresCurrency: false,
    definitionVersion: 'i6.paid_link_clicks.v1',
  },
  {
    key: 'paid_provider_leads',
    source: 'social_ad_metrics_daily.leads',
    unit: 'count',
    requiresCurrency: false,
    definitionVersion: 'i6.paid_provider_leads.v1',
    limitation:
      'Provider-reported leads after S2.4 action-family de-duplication. Messaging ' +
      'conversations are deliberately NOT counted here, so a messaging-objective ' +
      'advertiser contributes a real zero. Not a count of conversations received.',
  },
];

export const BENCHMARK_METRICS_BY_KEY: ReadonlyMap<
  string,
  BenchmarkMetricDescriptor
> = new Map(BENCHMARK_METRICS.map((metric) => [metric.key, metric]));

/**
 * The only window a benchmark may be asked over.
 *
 * A single enumerated value rather than a `from`/`until` pair, and that is a
 * privacy control before it is a simplification. Arbitrary date ranges are a
 * differencing attack in plain sight: ask for 30 days, ask for 29, and the
 * difference is one day of one cohort — repeated narrowly enough, that isolates
 * a contributor. A fixed window has no dial to turn.
 *
 * "Completed days" excludes today. Intraday rows are marked `is_partial` and a
 * contributor whose D0 is three hours old would enter the distribution with a
 * near-zero spend that is not low performance but an incomplete day. §12.
 */
export type BenchmarkWindowKey = 'trailing_30_completed_days_v1';

export const BENCHMARK_WINDOW_KEYS: readonly BenchmarkWindowKey[] = [
  'trailing_30_completed_days_v1',
];

export const DEFAULT_BENCHMARK_WINDOW: BenchmarkWindowKey =
  'trailing_30_completed_days_v1';

export type BenchmarkWindowDefinition = {
  key: BenchmarkWindowKey;
  /** Inclusive first day, `YYYY-MM-DD`. */
  since: string;
  /** Inclusive last day, `YYYY-MM-DD`. Never today. */
  until: string;
  days: number;
  /**
   * The timezone whose calendar days the window means.
   *
   * UTC, and stated rather than assumed. Contribution rows are written under
   * `observed_on`, which the Social metrics table fills from the *ad account's*
   * timezone — Meta closes a São Paulo account's day at 03:00 UTC. So a
   * contributor's day boundary is its own account's, while the window that
   * selects those days is UTC. That is a deliberate mismatch of at most one day
   * at each edge, and the honest alternative — a per-contributor window — would
   * mean contributors covering different real periods inside one distribution,
   * which is worse and invisible.
   */
  timezone: 'UTC';
};

/**
 * Resolves the window, relative to an instant the caller supplies.
 *
 * Takes `now` rather than reading the clock so the projector, the specs and any
 * future scheduled job all resolve the same window from the same input. A
 * function that called `new Date()` internally could not be tested for the
 * boundary case that matters most: the moment the day rolls over.
 */
export function resolveBenchmarkWindow(
  key: BenchmarkWindowKey,
  now: Date,
): BenchmarkWindowDefinition {
  if (key !== 'trailing_30_completed_days_v1') {
    throw new Error(`Unsupported benchmark window: ${String(key)}.`);
  }

  const days = 30;
  // Yesterday, in UTC. Today is excluded because it is incomplete.
  const until = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
  );
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  return {
    key,
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
    days,
    timezone: 'UTC',
  };
}

/**
 * How much to trust a benchmark, without claiming statistics it does not do.
 *
 * Three named tiers, derived from sample size and coverage. Deliberately *not*
 * called a confidence interval and deliberately carrying no percentage: there is
 * no sampling model here, no variance estimate and no population to generalise
 * to. Calling a count of contributors "95% confidence" would be inventing
 * rigour, which §22 forbids. `quality` describes the evidence; it does not
 * quantify uncertainty.
 */
export type BenchmarkQualityTier = 'low' | 'moderate' | 'good';

export type BenchmarkQuality = {
  tier: BenchmarkQualityTier;
  /** Distinct consenting contexts in the distribution. */
  sampleSize: number;
  /**
   * Mean share of the window each contributor actually covered, 0–1.
   *
   * A contributor with 3 of 30 days and one with all 30 are not equally
   * informative, and §19 requires the difference to be disclosed rather than
   * silently averaged over.
   */
  meanCoverage: number;
  notes: readonly string[];
};

/** Minimum days a contributor must cover to enter a distribution at all. */
export const MIN_CONTRIBUTOR_COVERAGE_DAYS = 7;

export type BenchmarkPercentiles = {
  p25: number;
  median: number;
  p75: number;
};

export type BenchmarkProvenance = {
  metricKey: BenchmarkMetricKey;
  metricSource: string;
  definitionVersion: string;
  /** Version of the aggregation logic itself, independent of the metric. */
  aggregationVersion: string;
  contributionSource: 'leadflow_product_telemetry_daily';
  cohortEncodingVersion: string;
  window: BenchmarkWindowDefinition;
  /**
   * How the business-mode axis relates to time.
   *
   * `prospective_contribution_snapshot`: the mode is stamped onto each
   * contribution when it is collected and never revised. There is no history
   * table and no retroactive relabelling — a context that changes mode
   * contributes under the new one from that day forward, and its earlier rows
   * keep the mode that was true when they were written.
   */
  businessModeTemporalSemantics: 'prospective_contribution_snapshot';
};

export type BenchmarkDataQuality = {
  gateEnabled: boolean;
  consentRequired: true;
  sufficientSample: boolean;
  businessModeEligible: boolean;
  currencyCompatible: boolean;
  coverageEligible: boolean;
  limitations: readonly string[];
};

/** Why a benchmark is unavailable. Never a percentile in disguise. */
export type BenchmarkUnavailableReason =
  | 'gate_disabled'
  | 'insufficient_anonymous_sample'
  | 'unsupported_metric'
  | 'ineligible_cohort'
  | 'currency_required';

export type BenchmarkResult = {
  metricKey: BenchmarkMetricKey;
  cohort: BenchmarkCohort;
  unit: BenchmarkMetricDescriptor['unit'];
  available: boolean;
  /** Present only when `available` is false. */
  reason?: BenchmarkUnavailableReason;
  /**
   * Distinct contributing contexts.
   *
   * Reported even when unavailable, because "we have 2 of the 5 needed" is
   * useful and reveals nothing: it is a count with no identities, no values and
   * no way to attribute it. What is never reported below k is the distribution.
   */
  sampleSize: number;
  /** Null unless `available` — never a partial or placeholder distribution. */
  percentiles: BenchmarkPercentiles | null;
  quality: BenchmarkQuality;
  provenance: BenchmarkProvenance;
  dataQuality: BenchmarkDataQuality;
};

/** Version of the aggregation logic, surfaced in provenance. */
export const BENCHMARK_AGGREGATION_VERSION = 'i6.aggregation.v1';
