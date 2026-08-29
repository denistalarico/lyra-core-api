/**
 * What a metric *is*, declared once by the domain that owns it.
 *
 * The descriptor exists because a number alone cannot be safely consumed. `1420`
 * is spend or impressions or reach depending on a key the consumer has to know,
 * and — the part that actually causes wrong dashboards — two of those three may
 * be added across days while the third may not. A consumer that receives values
 * without descriptors has to hard-code that knowledge, which means every new
 * consumer re-derives it and one of them gets reach wrong.
 */

/**
 * How a value may be combined across the rows that carry it.
 *
 * This is the single most important field in the contract, and the one that
 * exists to prevent a specific, silent, client-facing error.
 */
export type IntelligenceAdditivity =
  /**
   * Add them. Valid across every dimension: days, campaigns, accounts.
   * Spend, impressions, clicks, counts of things that happened.
   */
  | 'sum'
  /**
   * Do not add them, in any direction.
   *
   * Reach is the canonical case: Meta de-duplicates people *within* the day it
   * measured, so two days of reach share an unknown number of the same people.
   * Adding them counts those people twice, and the result is larger than the
   * true reach by an amount nobody can measure after the fact. There is no
   * correct aggregate — only a measurement this system does not hold.
   */
  | 'non_additive'
  /**
   * A stock, not a flow: take the newest observation, never the sum.
   *
   * Follower counts, open pipeline value, anything that describes a state at a
   * point in time. Summing a stock over thirty days multiplies it by thirty.
   *
   * No metric in this first release is `latest`. It is declared now because the
   * alternative — adding it later — would mean every consumer written in between
   * assumed the enum was closed and switched exhaustively over three cases.
   */
  | 'latest'
  /**
   * A mean whose weights the fact set does not carry.
   *
   * Documented deliberately as the weakest of the four, and used only where the
   * owning domain can name the weight: an average response time over a period is
   * the total wait divided by the total pairs, which is *not* the mean of the
   * daily averages unless every day had the same number of pairs.
   *
   * Because that weight is not part of a `{ metricKey, value }` fact, a
   * consumer cannot correctly re-aggregate an `average` metric across rows. The
   * rule is therefore the same as `non_additive` in practice — combine only what
   * the owning adapter combined — and a domain that needs a period average must
   * expose it at `period` grain, computed from its own totals. See
   * `assertAggregable`.
   */
  | 'average';

/**
 * The unit a value is expressed in, so a consumer can format it without
 * guessing from the key's name.
 */
export type IntelligenceMetricUnit =
  /** A money amount, in the currency the fact set declares. */
  | 'currency'
  /** A whole count of things. */
  | 'count'
  /** A count of people, which is where non-additivity usually lives. */
  | 'people'
  /** A duration in seconds. */
  | 'seconds'
  /** A dimensionless quotient (ROAS). */
  | 'ratio'
  /** A quotient already multiplied by 100 (CTR). */
  | 'percent';

export type IntelligenceMetricDescriptor = {
  /**
   * Stable, provider-neutral, `snake_case`.
   *
   * Provider-neutral in the strong sense: `spend`, not `meta_spend`. Which
   * provider produced it is a dimension, because the day Google Ads arrives the
   * key must not fork — a consumer summing spend across providers should not
   * have to know the set of providers to do it.
   */
  key: string;
  unit: IntelligenceMetricUnit;
  additivity: IntelligenceAdditivity;
  /**
   * True when the value is computed rather than observed.
   *
   * Every metric in this release is `false`: ratios are not facts and travel as
   * `IntelligenceRatioDescriptor` instead. The field is here so that a future
   * derived-but-still-additive metric can be labelled rather than smuggled in.
   */
  derived: boolean;
  /**
   * Where the number comes from, named concretely enough to be checked.
   *
   * A table and column, or a projection and field — not "the Social module".
   * This is the field somebody reads when a number is disputed.
   */
  source: string;
  /** How it is computed, when that is not simply "the stored column". */
  formula?: string;
  /**
   * What the number cannot be used for.
   *
   * Populated wherever the honest answer is narrower than the name suggests.
   * Reach's limitation is the reason the field exists.
   */
  limitation?: string;
};

/**
 * Refuses an aggregation the metric's additivity does not permit.
 *
 * Called by adapters before they combine anything, and available to consumers
 * for the same purpose. It throws rather than returning `null`, because the
 * caller has already decided to sum by the time it asks: a silent null here
 * would appear downstream as "no data", which is a different claim from "this
 * cannot be summed" and hides the bug instead of surfacing it.
 *
 * `rowCount <= 1` is always allowed — combining one row is a no-op, and that is
 * exactly the single-day case where reach is legitimately reportable.
 */
export function assertAggregable(
  descriptor: IntelligenceMetricDescriptor,
  rowCount: number,
): void {
  if (rowCount <= 1) return;

  if (descriptor.additivity === 'sum') return;

  throw new Error(
    `Metric ${descriptor.key} is ${descriptor.additivity} and cannot be ` +
      `aggregated across ${rowCount} rows.`,
  );
}

/** Whether combining this many rows is permitted, without throwing. */
export function isAggregable(
  descriptor: IntelligenceMetricDescriptor,
  rowCount: number,
): boolean {
  return rowCount <= 1 || descriptor.additivity === 'sum';
}
