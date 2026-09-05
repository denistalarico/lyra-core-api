import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import {
  BENCHMARK_AGGREGATION_VERSION,
  BENCHMARK_COHORT_VERSION,
  BENCHMARK_METRICS_BY_KEY,
  computePercentiles,
  isBenchmarkEligibleBusinessMode,
  MIN_CONTRIBUTOR_COVERAGE_DAYS,
  resolveBenchmarkWindow,
  serializeBenchmarkCohortKey,
  type BenchmarkCohort,
  type BenchmarkDataQuality,
  type BenchmarkMetricKey,
  type BenchmarkQuality,
  type BenchmarkResult,
  type BenchmarkWindowKey,
} from '../../../common/intelligence';
import { BENCHMARK_SYSTEM_BUSINESS_MODES } from '../../leadflow-analytics/intelligence/benchmark-business-mode-vocabulary';

/**
 * Reads a cross-tenant benchmark out of anonymous contributions.
 *
 * The read path deliberately touches exactly one table —
 * `leadflow_product_telemetry_daily` — and that table holds no tenant,
 * workspace, client, account, campaign, ad set, ad, conversation or contact
 * identifier. Its only identity column is the random `scope_pseudonym`. So the
 * strongest privacy property here is structural rather than enforced: there is
 * no cross-tenant query over operational data because the operational tables are
 * not in the query.
 *
 * ## Consent is not checked here, and that is correct
 *
 * A row exists in the fact table only if a context consented under a valid
 * notice, the gate was on, and collection ran — `collectSnapshot` refuses
 * otherwise. Revocation deletes future collection; erasure deletes the rows and
 * the identity link. So consent is enforced at *write* time and propagates to
 * every reader for free. Re-checking it here would mean joining the consent
 * table back to the pseudonym, which would rebuild exactly the linkage the
 * pseudonym exists to break.
 *
 * ## What "the caller" can influence
 *
 * A metric key from a closed set, a cohort from a closed vocabulary, and a
 * window from a one-member enum. Nothing else. There is no tenant filter, no
 * exclusion list, no arbitrary date range and no dimension the caller invents —
 * so there is no dial to turn for a differencing attack. §17 and §25.
 */
@Injectable()
export class BenchmarkService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async getBenchmark(input: {
    metricKey: BenchmarkMetricKey;
    cohort: BenchmarkCohort;
    windowKey: BenchmarkWindowKey;
    now?: Date;
  }): Promise<BenchmarkResult> {
    const descriptor = BENCHMARK_METRICS_BY_KEY.get(input.metricKey);
    const window = resolveBenchmarkWindow(
      input.windowKey,
      input.now ?? new Date(),
    );

    if (!descriptor) {
      return this.unavailable({
        ...input,
        window,
        reason: 'unsupported_metric',
        sampleSize: 0,
        limitations: [`Unknown metric key: ${input.metricKey}.`],
      });
    }

    // Eligibility of the *cohort itself*, independent of any data. A custom or
    // unknown business mode is refused before a query runs, because the refusal
    // is semantic: those modes are not comparable across tenants at all.
    if (
      !isBenchmarkEligibleBusinessMode(
        input.cohort.businessModeKey,
        BENCHMARK_SYSTEM_BUSINESS_MODES,
      )
    ) {
      return this.unavailable({
        ...input,
        window,
        descriptor,
        reason: 'ineligible_cohort',
        sampleSize: 0,
        businessModeEligible: false,
        limitations: [
          'Only system-defined business modes participate in cross-tenant cohorts. ' +
            'A tenant-custom mode is never mapped onto an official one.',
        ],
      });
    }

    if (descriptor.requiresCurrency && !input.cohort.currency) {
      return this.unavailable({
        ...input,
        window,
        descriptor,
        reason: 'currency_required',
        sampleSize: 0,
        currencyCompatible: false,
        limitations: [
          'Monetary benchmarks are split by currency and no FX is applied.',
        ],
      });
    }

    // The gate. Checked after cohort validation so an invalid request is still
    // told it is invalid, but before any data is read — with the gate off, no
    // contribution is being collected and any distribution would describe a
    // frozen past rather than the window it claims.
    if (!this.isEnabled()) {
      return this.unavailable({
        ...input,
        window,
        descriptor,
        reason: 'gate_disabled',
        sampleSize: 0,
        limitations: [
          'Anonymous learning is disabled for this deployment. No contribution is ' +
            'collected and no benchmark is produced.',
        ],
      });
    }

    const dimensionKey = serializeBenchmarkCohortKey(
      input.cohort,
      BENCHMARK_SYSTEM_BUSINESS_MODES,
    );
    const contributors = await this.contributorValues({
      metricKey: input.metricKey,
      dimensionKey,
      since: window.since,
      until: window.until,
    });

    const threshold = this.kAnonymityThreshold();
    const sampleSize = contributors.length;
    const quality = this.quality(contributors, window.days);

    if (sampleSize < threshold) {
      return this.unavailable({
        ...input,
        window,
        descriptor,
        reason: 'insufficient_anonymous_sample',
        sampleSize,
        quality,
        limitations: [
          `A benchmark requires at least ${threshold} independent contributing contexts.`,
        ],
      });
    }

    return {
      metricKey: input.metricKey,
      cohort: input.cohort,
      unit: descriptor.unit,
      available: true,
      sampleSize,
      percentiles: computePercentiles(contributors.map((entry) => entry.value)),
      quality,
      provenance: {
        metricKey: input.metricKey,
        metricSource: descriptor.source,
        definitionVersion: descriptor.definitionVersion,
        aggregationVersion: BENCHMARK_AGGREGATION_VERSION,
        contributionSource: 'leadflow_product_telemetry_daily',
        cohortEncodingVersion: BENCHMARK_COHORT_VERSION,
        window,
        businessModeTemporalSemantics: 'prospective_contribution_snapshot',
      },
      dataQuality: {
        gateEnabled: true,
        consentRequired: true,
        sufficientSample: true,
        businessModeEligible: true,
        currencyCompatible: true,
        coverageEligible: true,
        limitations: descriptor.limitation ? [descriptor.limitation] : [],
      },
    };
  }

  /**
   * One aggregated value per contributor — the §10 weighting rule, in SQL.
   *
   * The inner aggregation is by `scope_pseudonym`, so a context with 30 days and
   * 40 campaigns produces exactly one row here, the same as a context with 8
   * days and one campaign. Facts are summed *first* and the distribution is
   * taken over the results; that ordering is also what makes a future derived
   * ratio correct (§11), since the ratio would be formed from these per-
   * contributor sums rather than from daily quotients.
   *
   * `HAVING COUNT(*) >= coverage` is the §19 quality floor: a contributor that
   * covered three days of a thirty-day window is not describing the same period
   * as one that covered all thirty, and letting it in would understate every
   * count-based percentile.
   */
  private async contributorValues(input: {
    metricKey: string;
    dimensionKey: string;
    since: string;
    until: string;
  }): Promise<ContributorValue[]> {
    const rows = await this.dataSource.query<ContributorRow[]>(
      `
        /* intelligence-benchmark:contributor-distribution */
        SELECT
          SUM(fact.metric_value)::text AS value,
          COUNT(*)::text               AS covered_days
        FROM leadflow_product_telemetry_daily fact
        WHERE fact.metric_key = $1
          AND fact.dimension_key = $2
          AND fact.observed_on >= $3::date
          AND fact.observed_on <= $4::date
        GROUP BY fact.scope_pseudonym
        HAVING COUNT(*) >= $5
      `,
      [
        input.metricKey,
        input.dimensionKey,
        input.since,
        input.until,
        MIN_CONTRIBUTOR_COVERAGE_DAYS,
      ],
    );

    return rows.map((row) => ({
      // Number, not bigint: percentiles interpolate, so the distribution is
      // real-valued by definition. The magnitudes here are window sums of one
      // advertiser's spend or impressions, far inside the safe integer range.
      value: Number(row.value),
      coveredDays: Number(row.covered_days),
    }));
  }

  /**
   * Operational quality, with no statistical claim attached.
   *
   * Tiers are thresholds on things actually measured — how many contexts, and
   * how much of the window they covered. There is no confidence interval, no
   * p-value and no percentage, because there is no sampling model to derive one
   * from: these contributors are whoever opted in, not a random draw from a
   * population. §22.
   */
  private quality(
    contributors: readonly ContributorValue[],
    windowDays: number,
  ): BenchmarkQuality {
    const sampleSize = contributors.length;
    const meanCoverage = sampleSize
      ? contributors.reduce((sum, entry) => sum + entry.coveredDays, 0) /
        (sampleSize * windowDays)
      : 0;

    const notes: string[] = [];
    let tier: BenchmarkQuality['tier'] = 'low';

    if (sampleSize >= 20 && meanCoverage >= 0.8) tier = 'good';
    else if (sampleSize >= 10 && meanCoverage >= 0.5) tier = 'moderate';

    if (sampleSize < 10) {
      notes.push(
        'Few contributing contexts; percentiles move substantially with each addition.',
      );
    }
    if (meanCoverage < 0.5 && sampleSize > 0) {
      notes.push(
        'Contributors covered under half the window on average; totals understate a full period.',
      );
    }
    notes.push(
      'Operational quality indicator, not a statistical confidence interval.',
    );

    return { tier, sampleSize, meanCoverage, notes };
  }

  private unavailable(input: {
    metricKey: BenchmarkMetricKey;
    cohort: BenchmarkCohort;
    window: BenchmarkResult['provenance']['window'];
    reason: NonNullable<BenchmarkResult['reason']>;
    sampleSize: number;
    descriptor?: {
      unit: BenchmarkResult['unit'];
      source: string;
      definitionVersion: string;
      limitation?: string;
    };
    quality?: BenchmarkQuality;
    businessModeEligible?: boolean;
    currencyCompatible?: boolean;
    limitations: readonly string[];
  }): BenchmarkResult {
    const dataQuality: BenchmarkDataQuality = {
      gateEnabled: this.isEnabled(),
      consentRequired: true,
      sufficientSample: false,
      businessModeEligible: input.businessModeEligible ?? true,
      currencyCompatible: input.currencyCompatible ?? true,
      coverageEligible: input.sampleSize > 0,
      limitations: [
        ...input.limitations,
        ...(input.descriptor?.limitation ? [input.descriptor.limitation] : []),
      ],
    };

    return {
      metricKey: input.metricKey,
      cohort: input.cohort,
      unit: input.descriptor?.unit ?? 'count',
      available: false,
      reason: input.reason,
      sampleSize: input.sampleSize,
      // Never a partial distribution, never a placeholder zero.
      percentiles: null,
      quality: input.quality ?? {
        tier: 'low',
        sampleSize: input.sampleSize,
        meanCoverage: 0,
        notes: [
          'Operational quality indicator, not a statistical confidence interval.',
        ],
      },
      provenance: {
        metricKey: input.metricKey,
        metricSource: input.descriptor?.source ?? 'unknown',
        definitionVersion: input.descriptor?.definitionVersion ?? 'unknown',
        aggregationVersion: BENCHMARK_AGGREGATION_VERSION,
        contributionSource: 'leadflow_product_telemetry_daily',
        cohortEncodingVersion: BENCHMARK_COHORT_VERSION,
        window: input.window,
        businessModeTemporalSemantics: 'prospective_contribution_snapshot',
      },
      dataQuality,
    };
  }

  /**
   * The same gate the collection path reads, deliberately not a second one.
   *
   * §33 asks for the existing gate to be audited and reused rather than joined
   * by a parallel flag. One env var means one thing to turn off, and it is
   * currently unset in production — so this returns false there, which is the
   * intended fail-closed state.
   */
  private isEnabled(): boolean {
    return process.env.LEADFLOW_PRODUCT_TELEMETRY_ENABLED === 'true';
  }

  /** The existing k, from the same env var the aggregate reader uses. */
  private kAnonymityThreshold(): number {
    const parsed = Number(
      process.env.LEADFLOW_PRODUCT_TELEMETRY_K_ANONYMITY ?? 5,
    );
    return Number.isInteger(parsed) && parsed >= 5 ? parsed : 5;
  }
}

type ContributorValue = { value: number; coveredDays: number };
type ContributorRow = { value: string; covered_days: string };
