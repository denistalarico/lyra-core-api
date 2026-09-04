import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  sortDestinationBuckets,
  type SocialAdDestinationBreakdown,
  type SocialAdDestinationBucket,
} from '../analytics/social-ad-destination-breakdown';
import { SocialAdMetricDailyEntity } from '../entities/social-ad-metric-daily.entity';
import type { CanonicalPaidMediaDestination } from '../sync/paid-media-destination';

/**
 * The level this reads, and the reason it is not the one the dashboard reads.
 *
 * `SocialAnalyticsReadService` pins `entity_level = 'account'` on every query it
 * makes, because that is the figure that reconciles with Ads Manager. This read
 * pins `adset`, because destination is an ad-set property. The two are
 * incompatible rules over the same table, which is why this is a separate
 * service rather than a method there — a class whose every method must apply one
 * filter is exactly where a method that must apply a different one eventually
 * gets the wrong one applied to it.
 *
 * The account and campaign rows are not merely irrelevant here, they are
 * poisonous: they describe the *same money* at a coarser grain, so a query
 * missing this filter reports about three times the real spend while looking
 * entirely correct.
 */
const DESTINATION_ENTITY_LEVEL = 'adset';

/** The same two pins every analytics read applies, for the same reasons. */
const DESTINATION_SOURCE = 'paid';
const DESTINATION_ATTRIBUTION = 'account_default';

export type SocialAdDestinationBreakdownInput = {
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  since: string;
  until: string;
  /** The ad account's IANA zone, whose calendar days the observations are cut in. */
  timezone: string | null;
  /** Days in the requested window, for coverage reporting. */
  expectedDays: number;
};

/** One grouped row as Postgres returns it — every column text or null. */
type BreakdownRow = {
  destination: string | null;
  observed: string;
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  link_clicks: string | null;
  leads: string | null;
  conversions: string | null;
  conversion_value: string | null;
  video_views: string | null;
  fact_days: string | null;
  partial_days: string | null;
  currency: string | null;
};

/**
 * Ad-set spend and delivery, grouped by the destination observed on each day.
 *
 * The read that I3.4 unblocked and I3.5 wires up. Everything it returns is
 * additive: money and counts that can be summed over ad sets and days without a
 * weighting. Reach is refused rather than approximated, and no ratio is computed
 * here — a quotient of two sums is formed once, by the consumer, from these
 * totals.
 *
 * No Graph service, no credential resolver, no token. It reads three local
 * tables and would answer identically for a disconnected account, because a
 * disconnected account's history is still true.
 */
@Injectable()
export class SocialAdDestinationBreakdownReadService {
  constructor(
    @InjectRepository(SocialAdMetricDailyEntity, 'agency')
    private readonly metrics: Repository<SocialAdMetricDailyEntity>,
  ) {}

  /**
   * One bucket per destination observed in the window.
   *
   * Scope is bound on every predicate and there is no parameter that could widen
   * it. The connection has already been resolved under tenant, workspace and
   * managed client by the caller, and tenant and workspace are re-bound here
   * anyway: a connection id alone would be enough to find the rows, and binding
   * only it would make this the one read in the module where a leaked uuid
   * crosses a tenant.
   */
  async breakdown(
    input: SocialAdDestinationBreakdownInput,
  ): Promise<SocialAdDestinationBreakdown> {
    const rows = await this.metrics.query<BreakdownRow[]>(
      DESTINATION_BREAKDOWN_SQL,
      [
        input.tenantId,
        input.workspaceId,
        input.connectionId,
        input.since,
        input.until,
        input.timezone,
        DESTINATION_ENTITY_LEVEL,
        DESTINATION_SOURCE,
        DESTINATION_ATTRIBUTION,
      ],
    );

    const buckets = new Map<string, SocialAdDestinationBucket>();
    let currency: string | null = null;
    const days = new Set<string>();

    for (const row of rows) {
      /**
       * A day with no observation behind it becomes `unknown`, and its spend is
       * remembered separately.
       *
       * The SQL groups on both the resolved destination and whether one was
       * observed at all, so an ad set whose provider string mapped to the
       * literal canonical value `unknown` and an ad set that was never observed
       * arrive as two rows here and are folded into one bucket — with
       * `temporalUnknownSpend` recording how much of it is the second kind.
       * Merging them without that split would leave a reader unable to tell a
       * sync that has not caught up from a mapping that needs an entry.
       */
      const destination = (row.destination ??
        'unknown') as CanonicalPaidMediaDestination;
      const temporal = row.observed === 'false';

      const existing = buckets.get(destination);
      const merged = addBucket(existing, row, destination, temporal);

      buckets.set(destination, merged);
      currency ??= row.currency;

      const factDays = readCount(row.fact_days);
      if (factDays > 0) days.add(`${destination}:${row.observed}`);
    }

    /**
     * Distinct days, counted in SQL rather than inferred from the buckets.
     *
     * Two destinations can hold facts on the same day, so summing each bucket's
     * `factDays` would count that day twice and could report coverage above the
     * window's own length.
     */
    const coveredDays = await this.countCoveredDays(input);

    return {
      buckets: sortDestinationBuckets([...buckets.values()]),
      currency,
      hasAdsetFacts: coveredDays > 0,
      coveredDays,
      expectedDays: input.expectedDays,
    };
  }

  /**
   * Days in the window that carry any ad-set fact.
   *
   * The measurement that separates "this window has not been ingested at ad-set
   * level yet" from "nothing was delivered". I3.4 widened the coverage
   * requirement, so a connection whose account chain is complete can legitimately
   * hold zero ad-set rows for an old window while the re-read works backwards —
   * and reporting that as an empty breakdown without this number would look like
   * a period of no spend.
   */
  private async countCoveredDays(
    input: SocialAdDestinationBreakdownInput,
  ): Promise<number> {
    const rows = await this.metrics.query<Array<{ days: string | null }>>(
      `
        /* social-ad-destination:covered-days */
        SELECT COUNT(DISTINCT fact.metric_date)::text AS "days"
        FROM social_ad_metrics_daily fact
        WHERE fact.tenant_id = $1
          AND fact.workspace_id = $2
          AND fact.connection_id = $3
          AND fact.entity_level = $6
          AND fact.source = $7
          AND fact.attribution_setting = $8
          AND fact.metric_date BETWEEN $4::date AND $5::date
      `,
      [
        input.tenantId,
        input.workspaceId,
        input.connectionId,
        input.since,
        input.until,
        DESTINATION_ENTITY_LEVEL,
        DESTINATION_SOURCE,
        DESTINATION_ATTRIBUTION,
      ],
    );

    return readCount(rows[0]?.days ?? null);
  }
}

/**
 * The breakdown query.
 *
 * Written as SQL text rather than through the query builder because the join it
 * needs is a `LATERAL` — "the newest observation at or before this day, per ad
 * set" — which TypeORM's builder cannot express, and the alternative shapes are
 * both worse. A correlated subquery per metric row was measured at roughly three
 * times the cost of the set-based form on a large fixture (see
 * `social-ad-destination-timeline`), and pulling the intervals into memory to
 * match them in TypeScript would move a join into the application for no gain.
 *
 * ## The join, clause by clause
 *
 * The fact joins `social_ad_entities` on the **external id at ad-set level**,
 * scoped by tenant, workspace and connection. Meta object ids are unique per
 * object type and not across types, so without `entity.entity_level = 'adset'` a
 * campaign sharing an ad set's id would match — the same collision I3.4's writer
 * spec pins in the fact table's unique key.
 *
 * The `LATERAL` then takes the newest observation whose instant, converted into
 * the account's zone, falls on or before the metric's own day. The conversion is
 * the same one every other day bucket in this codebase applies: an observation
 * at 21:00 São Paulo time is the 14th there and the 15th in UTC, and the facts it
 * is being matched to were cut the local way. Comparing the raw instant would put
 * every late-evening observation one day late.
 *
 * `observed` travels out of the lateral as a boolean so the caller can tell an
 * ad set with no observation yet from one observed to point somewhere this
 * pipeline does not map. Both are `unknown`; only the first will fix itself.
 *
 * The timezone is a bound parameter, never interpolated — it is the one value
 * here that originates outside this file.
 *
 * Parameters: `$1` tenant, `$2` workspace, `$3` connection, `$4` since, `$5`
 * until, `$6` timezone, `$7` entity level, `$8` source, `$9` attribution.
 */
const DESTINATION_BREAKDOWN_SQL = `
  /* social-ad-destination:breakdown */
  SELECT resolved.destination_type AS "destination",
         (resolved.destination_type IS NOT NULL)::text AS "observed",
         SUM(fact.spend)::text AS "spend",
         SUM(fact.impressions)::text AS "impressions",
         SUM(fact.clicks)::text AS "clicks",
         SUM(fact.link_clicks)::text AS "link_clicks",
         SUM(fact.leads)::text AS "leads",
         SUM(fact.conversions)::text AS "conversions",
         SUM(fact.conversion_value)::text AS "conversion_value",
         SUM(fact.video_views)::text AS "video_views",
         COUNT(DISTINCT fact.metric_date)::text AS "fact_days",
         COUNT(DISTINCT fact.metric_date)
           FILTER (WHERE fact.is_partial)::text AS "partial_days",
         MAX(fact.currency) AS "currency"
  FROM social_ad_metrics_daily fact
  JOIN social_ad_entities entity
    ON entity.tenant_id = fact.tenant_id
   AND entity.workspace_id = fact.workspace_id
   AND entity.connection_id = fact.connection_id
   AND entity.entity_level = $7
   AND entity.external_id = fact.entity_external_id
  LEFT JOIN LATERAL (
    SELECT observation.destination_type
    FROM social_ad_destination_observations observation
    WHERE observation.ad_entity_id = entity.id
      AND (CASE WHEN $6::text IS NULL THEN observation.observed_at
                ELSE observation.observed_at AT TIME ZONE $6::text END)::date
          <= fact.metric_date
    ORDER BY observation.observed_at DESC, observation.created_at DESC
    LIMIT 1
  ) resolved ON TRUE
  WHERE fact.tenant_id = $1
    AND fact.workspace_id = $2
    AND fact.connection_id = $3
    AND fact.entity_level = $7
    AND fact.source = $8
    AND fact.attribution_setting = $9
    AND fact.metric_date BETWEEN $4::date AND $5::date
  GROUP BY 1, 2
`;

/**
 * Folds one grouped row into a bucket, summing in `BigInt` and decimal strings.
 *
 * No `Number` appears in this path. Spend and conversion value are
 * `numeric(18,6)` and the counts are `bigint`; parsing either into a double and
 * adding would drift in the cents on real data and silently overflow above 2^53
 * on impressions for a large account.
 */
function addBucket(
  existing: SocialAdDestinationBucket | undefined,
  row: BreakdownRow,
  destination: CanonicalPaidMediaDestination,
  temporalUnknown: boolean,
): SocialAdDestinationBucket {
  const base: SocialAdDestinationBucket = existing ?? {
    destination,
    temporalUnknownSpend: null,
    spend: null,
    impressions: null,
    clicks: null,
    linkClicks: null,
    providerLeads: null,
    conversions: null,
    conversionValue: null,
    videoViews: null,
    reach: null,
    factDays: 0,
    partialDays: 0,
  };

  return {
    destination,
    temporalUnknownSpend: temporalUnknown
      ? addDecimal(base.temporalUnknownSpend, row.spend)
      : base.temporalUnknownSpend,
    spend: addDecimal(base.spend, row.spend),
    impressions: addInteger(base.impressions, row.impressions),
    clicks: addInteger(base.clicks, row.clicks),
    linkClicks: addInteger(base.linkClicks, row.link_clicks),
    providerLeads: addInteger(base.providerLeads, row.leads),
    /**
     * Decimal, not integer — `conversions` is `numeric(18,6)`, not a count.
     *
     * Meta credits one conversion across two ads as two halves under attribution
     * splitting, so the column stores fractions and `SUM()` hands back
     * `0.000000`. Folding it as a `bigint` throws on the first row that has one.
     */
    conversions: addDecimal(base.conversions, row.conversions),
    conversionValue: addDecimal(base.conversionValue, row.conversion_value),
    videoViews: addInteger(base.videoViews, row.video_views),
    reach: null,
    /**
     * Summed across the two rows a destination can arrive in.
     *
     * Only `unknown` ever has two, and its two halves are disjoint by
     * construction — a day is either before an ad set's first observation or
     * after it — so adding them cannot double-count a day for a single ad set.
     * Two *different* ad sets sharing a day is a genuine one-day overlap this
     * per-bucket figure does not try to de-duplicate; `coveredDays` on the
     * breakdown is the window-level number and is counted in SQL.
     */
    factDays: base.factDays + readCount(row.fact_days),
    partialDays: base.partialDays + readCount(row.partial_days),
  };
}

/** Decimal addition on `numeric` text, via scaled integers. Never a float. */
function addDecimal(left: string | null, right: string | null): string | null {
  if (right === null) return left;
  if (left === null) return right;

  const scale = 6;
  const scaled = (value: string): bigint => {
    const negative = value.startsWith('-');
    const digits = negative ? value.slice(1) : value;
    const [whole, fraction = ''] = digits.split('.');
    const padded = (fraction + '0'.repeat(scale)).slice(0, scale);
    const magnitude = BigInt(`${whole || '0'}${padded}`);

    return negative ? -magnitude : magnitude;
  };

  const total = scaled(left) + scaled(right);
  const negative = total < 0n;
  const magnitude = (negative ? -total : total)
    .toString()
    .padStart(scale + 1, '0');
  const whole = magnitude.slice(0, magnitude.length - scale);
  const fraction = magnitude.slice(magnitude.length - scale);

  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Integer addition on `bigint` text. */
function addInteger(left: string | null, right: string | null): string | null {
  if (right === null) return left;
  if (left === null) return right;

  return (BigInt(left) + BigInt(right)).toString();
}

/** A count column as a number, with null and unparsable text meaning zero. */
function readCount(value: string | null): number {
  if (value === null) return 0;

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : 0;
}
