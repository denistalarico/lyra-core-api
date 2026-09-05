import type { BenchmarkPercentiles } from './intelligence-benchmark';

/**
 * Percentiles over one value per contributor.
 *
 * Computed in TypeScript rather than by `percentile_cont` in SQL, and the reason
 * is the §10/§14 weighting rule rather than a preference. The distribution's
 * members are *contributors*, not fact rows: each context contributes exactly
 * one aggregated value per window and metric, so a company with a million rows
 * and a company with three both count once. Doing this in SQL would mean an
 * inner aggregation per pseudonym followed by an outer `percentile_cont` over
 * its result — expressible, but the shape that reads naturally
 * (`percentile_cont(...) FROM facts`) is exactly the wrong one, and it would
 * weight by row count while looking correct.
 *
 * Pulling the per-contributor values out first and computing here makes the
 * weighting impossible to get wrong by accident, and makes the arithmetic
 * testable without a database.
 *
 * ## Interpolation
 *
 * Linear between the two nearest ranks — the same definition PostgreSQL's
 * `percentile_cont` uses, so a future move into SQL would not shift published
 * numbers. `percentile_disc` would pick an actual member's value instead, which
 * for a sample at exactly k means publishing one real contributor's figure
 * verbatim. Interpolation blends at least two of them, which is a small but
 * genuine privacy improvement at the sample sizes this system will actually see.
 */
export function computePercentiles(
  values: readonly number[],
): BenchmarkPercentiles {
  if (values.length === 0) {
    throw new Error('computePercentiles requires at least one value.');
  }

  const sorted = [...values].sort((a, b) => a - b);

  return {
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
  };
}

/**
 * The `percentile_cont` definition, on an already-sorted array.
 *
 * Position is `p * (n - 1)`, so p=0 is the first element and p=1 the last, with
 * everything between interpolated. A single-element array returns that element
 * for every p, which is arithmetically right and is also why the k threshold is
 * enforced by the caller and not here — this function has no idea whether one
 * value is a legitimate answer or a privacy breach.
 */
function quantile(sorted: readonly number[], p: number): number {
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);

  if (lower === upper) return sorted[lower];

  const weight = position - lower;

  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}
