import { ConflictException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import {
  BENCHMARK_METRICS,
  serializeBenchmarkCohortKey,
  toMinorUnits,
  type BenchmarkCohort,
  type BenchmarkDestination,
  type IntelligenceScope,
} from '../../../common/intelligence';
import { BENCHMARK_SYSTEM_BUSINESS_MODES } from '../../leadflow-analytics/intelligence/benchmark-business-mode-vocabulary';

/**
 * Turns a context's own paid-media facts into privacy-safe daily contributions.
 *
 * This is the "contribution ≠ raw export" boundary from §5, implemented as a
 * *write* rather than a read. Nothing in the benchmark read path ever touches
 * `social_ad_metrics_daily` across tenants; a cross-tenant query over
 * operational tables would defeat the entire privacy model no matter what it
 * filtered on. Instead each consenting context aggregates its own rows, strips
 * every identifier, and deposits counts under its pseudonym — and the benchmark
 * reads only the deposits.
 *
 * ## What crosses the boundary
 *
 * Four or five integers per day per cohort, and a cohort key drawn from a closed
 * vocabulary. What does not cross: account id, campaign id, ad set id, ad id,
 * connection id, conversation id, contact id, user id, campaign or ad *names*,
 * creatives, raw provider payloads. The fact table has nowhere to put them —
 * its only identity column is `scope_pseudonym` — and this service never
 * selects them.
 *
 * ## Why ad-set grain and nothing else
 *
 * `social_ad_metrics_daily` holds account, campaign and ad-set rows for the same
 * days, and summing across levels triple-counts every number (the I3.5 finding).
 * Ad set is also the *only* level at which a destination exists — Meta reports
 * `destination_type` on the ad set and nowhere else — and destination is a
 * required cohort axis. So the level is forced twice over, and the predicate is
 * explicit rather than implied by a join.
 */
@Injectable()
export class PaidMediaContributionService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  /**
   * Builds the contribution rows for a scope and day range.
   *
   * Returns them rather than writing them: the caller owns consent, the
   * pseudonym and the audit trail, and this service owns the arithmetic. That
   * split is what lets the whole builder be tested without a consent fixture,
   * and it keeps the privacy decision in the module that already enforces it
   * everywhere else.
   *
   * `businessModeKey` is passed in, already resolved and already checked for
   * eligibility by the caller. Resolving it here would mean this module reaching
   * into LeadFlow settings, and — more importantly — the *caller* is where the
   * §5 rule lives that an ineligible mode contributes nothing at all.
   */
  async buildContributions(input: {
    scope: IntelligenceScope;
    businessModeKey: string;
    since: string;
    until: string;
  }): Promise<PaidMediaContribution[]> {
    const rows = await this.dataSource.query<PaidMediaFactRow[]>(
      `
        /* intelligence-benchmark:contribution-source */
        SELECT
          metrics.metric_date::text        AS observed_on,
          metrics.currency                 AS currency,
          COALESCE(destination.destination_type, 'unknown') AS destination,
          SUM(metrics.spend)::text         AS spend,
          SUM(metrics.impressions)::text   AS impressions,
          SUM(metrics.clicks)::text        AS clicks,
          SUM(metrics.link_clicks)::text   AS link_clicks,
          SUM(metrics.leads)::text         AS leads
        FROM social_ad_metrics_daily metrics
        LEFT JOIN LATERAL (
          -- The destination as it was known on the day being contributed, not
          -- as it is now. Observations are append-on-change, so the newest row
          -- at or before the metric date is the value that was true then. A
          -- day preceding the first observation resolves to NULL and falls
          -- through to 'unknown' above — the I4.1 rule, and the reason current
          -- destination is never used as a fallback.
          SELECT observation.destination_type
          FROM social_ad_destination_observations observation
          INNER JOIN social_ad_entities entity
            ON entity.id = observation.ad_entity_id
          WHERE entity.tenant_id = metrics.tenant_id
            AND entity.workspace_id = metrics.workspace_id
            AND entity.agency_client_id IS NOT DISTINCT FROM metrics.agency_client_id
            AND entity.external_id = metrics.entity_external_id
            AND entity.entity_level = 'adset'
            AND entity.provider = 'meta_ads'
            AND observation.observed_at::date <= metrics.metric_date
          ORDER BY observation.observed_at DESC
          LIMIT 1
        ) destination ON TRUE
        WHERE metrics.tenant_id = $1
          AND metrics.workspace_id = $2
          AND metrics.agency_client_id IS NOT DISTINCT FROM $3::uuid
          -- Ad set only. See the class docs: any other level double counts, and
          -- no other level carries a destination.
          AND metrics.entity_level = 'adset'
          AND metrics.provider = 'meta_ads'
          AND metrics.metric_date >= $4::date
          AND metrics.metric_date <= $5::date
          -- Intraday rows describe a day that is still happening. Contributing
          -- one would put a three-hour day into a distribution of full days.
          AND metrics.is_partial = false
        GROUP BY metrics.metric_date, metrics.currency, destination.destination_type
      `,
      [
        input.scope.tenantId,
        input.scope.workspaceId,
        input.scope.agencyClientId,
        input.since,
        input.until,
      ],
    );

    const contributions: PaidMediaContribution[] = [];

    for (const row of rows) {
      const currency = row.currency?.trim().toUpperCase() ?? null;

      // A monetary metric with no currency cannot be placed in a cohort, and
      // guessing one would silently mix money. The row's counts are still
      // contributed — only the spend metric drops out.
      const cohortBase = {
        businessModeKey: input.businessModeKey,
        provider: 'meta',
        destination: this.canonicalDestination(row.destination),
      };

      for (const metric of BENCHMARK_METRICS) {
        if (metric.requiresCurrency && !currency) continue;

        const cohort: BenchmarkCohort = {
          ...cohortBase,
          currency: metric.requiresCurrency ? currency : null,
        };

        const value = this.metricValue(metric.key, row, currency);

        if (value === null) continue;

        contributions.push({
          observedOn: row.observed_on,
          metricKey: metric.key,
          dimensionKey: serializeBenchmarkCohortKey(
            cohort,
            BENCHMARK_SYSTEM_BUSINESS_MODES,
          ),
          metricValue: value.toString(),
        });
      }
    }

    return contributions;
  }

  /**
   * The metric's value for one source row, as an exact integer.
   *
   * Spend goes through `toMinorUnits`, which never converts to a float. The
   * counts are already integers in `bigint` columns and are re-parsed through
   * `BigInt` rather than `Number`, because a summed impression count can exceed
   * `Number.MAX_SAFE_INTEGER` and the failure mode of that is a wrong number
   * rather than an error.
   */
  private metricValue(
    key: string,
    row: PaidMediaFactRow,
    currency: string | null,
  ): bigint | null {
    switch (key) {
      case 'paid_spend_minor_units':
        if (!currency || row.spend === null) return null;
        return toMinorUnits(row.spend, currency);
      case 'paid_impressions':
        return integerOrNull(row.impressions);
      case 'paid_clicks':
        return integerOrNull(row.clicks);
      case 'paid_link_clicks':
        return integerOrNull(row.link_clicks);
      case 'paid_provider_leads':
        return integerOrNull(row.leads);
      default:
        throw new ConflictException(`Unknown benchmark metric: ${key}.`);
    }
  }

  /**
   * A stored `destination_type` mapped onto the cohort vocabulary.
   *
   * Anything unrecognised becomes `unknown` rather than being dropped. Dropping
   * would remove a real advertiser from every cohort the day Meta ships a new
   * destination value, which biases the benchmark toward whoever runs older
   * campaign types — a silent distortion. `unknown` is an honest cohort.
   */
  private canonicalDestination(value: string | null): BenchmarkDestination {
    const candidate = (value ?? 'unknown').trim();
    const known: readonly BenchmarkDestination[] = [
      'whatsapp',
      'instagram_direct',
      'messenger',
      'messaging_multi',
      'website',
      'lead_form',
      'app',
      'phone',
      'profile',
      'on_post',
      'unknown',
    ];

    return known.includes(candidate as BenchmarkDestination)
      ? (candidate as BenchmarkDestination)
      : 'unknown';
  }
}

export type PaidMediaContribution = {
  observedOn: string;
  metricKey: string;
  dimensionKey: string;
  metricValue: string;
};

type PaidMediaFactRow = {
  observed_on: string;
  currency: string | null;
  destination: string | null;
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  link_clicks: string | null;
  leads: string | null;
};

function integerOrNull(value: string | null): bigint | null {
  if (value === null) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}
