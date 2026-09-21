import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  describeBreakdownKey,
  sortBreakdownBuckets,
  type SocialAdBreakdownBucket,
  type SocialAdBreakdownView,
} from '../analytics/social-ad-breakdown-view';
import { parseAnalyticsPeriod } from '../analytics/social-ad-analytics-period';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import type { SocialAdBreakdownKind } from '../entities/social-ad-breakdown-daily.entity';
import { SocialAdBreakdownDailyEntity } from '../entities/social-ad-breakdown-daily.entity';

/**
 * The level this reads, pinned for the same reason every other analytics read
 * pins one.
 *
 * The ingest writes account level only today, so this filter changes nothing
 * yet — and it is here precisely because that will not always be true. The
 * moment campaign-level breakdowns are ingested, a query without this predicate
 * would sum the account row and every campaign row for the same day and report
 * several times the real spend, while looking entirely correct. The filter is
 * cheap now and is the difference between a correct read and a plausible one
 * later.
 */
const BREAKDOWN_ENTITY_LEVEL = 'account';

export type SocialAdBreakdownReadInput = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId?: string | null;
  connectionId: string;
  kind: SocialAdBreakdownKind;
  since: string;
  until: string;
};

/** One grouped row as Postgres returns it — every column text or null. */
type BreakdownAggregateRow = {
  breakdown_key: string;
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  link_clicks: string | null;
  fact_days: string | null;
  currency: string | null;
};

/**
 * One dimension's distribution over a window, from the local read model.
 *
 * A separate service from `SocialAnalyticsReadService`, following the precedent
 * `SocialAdDestinationBreakdownReadService` set: that class's every method is
 * governed by the four rules that make unsplit paid metrics correct
 * (`entity_level`, `source`, `attribution_setting`, reach), and this table obeys
 * a different set — it has no `source` or `attribution_setting` column at all,
 * and its reach is non-additive in one more direction than theirs. A class whose
 * every method must apply one rule set is exactly where a method that needs
 * another eventually gets the wrong one applied to it.
 *
 * No Graph service, no credential resolver, no token. It reads two local tables
 * and would answer identically for a disconnected account, because a
 * disconnected account's history is still true.
 */
@Injectable()
export class SocialAdBreakdownReadService {
  constructor(
    @InjectRepository(SocialAdAccountConnectionEntity, 'agency')
    private readonly connectionsRepository: Repository<SocialAdAccountConnectionEntity>,
    @InjectRepository(SocialAdBreakdownDailyEntity, 'agency')
    private readonly breakdownRepository: Repository<SocialAdBreakdownDailyEntity>,
  ) {}

  /**
   * One bucket per value of the dimension observed in the window.
   *
   * Everything returned is additive: money and counts that can be summed over
   * days without a weighting. Reach is refused rather than approximated — see
   * the field's own note on the view — and no ratio is computed here, so a
   * quotient of two sums is formed once, by the consumer, from these totals.
   */
  async breakdown(
    input: SocialAdBreakdownReadInput,
  ): Promise<SocialAdBreakdownView> {
    const period = parseAnalyticsPeriod({
      since: input.since,
      until: input.until,
    });

    const connection = await this.findInScope(input);

    const rows = await this.breakdownRepository.query<BreakdownAggregateRow[]>(
      BREAKDOWN_AGGREGATE_SQL,
      [
        connection.tenantId,
        connection.workspaceId,
        connection.id,
        period.since,
        period.until,
        input.kind,
        BREAKDOWN_ENTITY_LEVEL,
      ],
    );

    const buckets: SocialAdBreakdownBucket[] = [];
    let currency: string | null = null;
    let coveredDays = 0;

    for (const row of rows) {
      buckets.push({
        key: row.breakdown_key,
        label: describeBreakdownKey(input.kind, row.breakdown_key),
        spend: row.spend,
        impressions: row.impressions,
        clicks: row.clicks,
        linkClicks: row.link_clicks,
        reach: null,
      });

      currency ??= row.currency;

      /**
       * The widest bucket's day count, not the sum of them.
       *
       * Two buckets hold rows on the same day by construction — that is what a
       * distribution is — so summing each bucket's day count would report
       * coverage several times the window's own length. The maximum is the
       * honest figure: a day covered for any bucket is a day this dimension was
       * ingested for.
       */
      coveredDays = Math.max(coveredDays, readCount(row.fact_days));
    }

    return {
      kind: input.kind,
      since: period.since,
      until: period.until,
      // From the connection rather than from a row: the account's zone is what
      // defined every stored `metric_date`, and it is the only zone in which the
      // requested period means what the caller intended.
      timezone: connection.timezone ?? 'UTC',
      currency,
      hasData: buckets.length > 0,
      coveredDays,
      expectedDays: period.days,
      buckets: sortBreakdownBuckets(input.kind, buckets),
    };
  }

  /**
   * Scope resolution and existence check are the same query, exactly as
   * `SocialAnalyticsReadService.findInScope` does it.
   *
   * A connection in another tenant, another workspace or another managed client
   * is "not found" — the same answer as an id that never existed. Answering
   * "forbidden" would confirm the id is real and make the endpoint an
   * enumeration oracle for which clients run ads.
   *
   * No filter on `connection_status`: a disconnected account's history is still
   * readable, because it is still true.
   */
  private async findInScope(input: SocialAdBreakdownReadInput) {
    const connection = await this.connectionsRepository.findOne({
      where: {
        id: input.connectionId,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        // `IsNull()` rather than `null`: agency scope must match rows where the
        // column is NULL, and TypeORM reads a literal null as "no filter" —
        // which would silently widen the lookup to every client.
        agencyClientId: input.agencyClientId ?? IsNull(),
        companyContextId: input.companyContextId ?? IsNull(),
      },
      // The stored scope travels with the row: the aggregate binds tenant and
      // workspace, and it must bind what is stored rather than what the caller
      // claimed, even though the row was found by them.
      select: ['id', 'timezone', 'tenantId', 'workspaceId'],
    });

    if (!connection) {
      throw new NotFoundException('Connection not found.');
    }

    return connection;
  }
}

/**
 * The aggregate, one row per bucket.
 *
 * Written as SQL text rather than through the query builder for the same reason
 * the destination breakdown is: the counts have to be cast to text on the way
 * out so that a `bigint` never becomes a JavaScript number, and the builder's
 * `addSelect` would return them typed by the driver instead.
 *
 * `reach` is deliberately not selected. There is no expression that could
 * produce a period figure from it — not `SUM`, which double-counts people across
 * days, and not `MAX`, which would report one day's reach as the period's.
 * Leaving it out of the query is what keeps a later edit from adding the
 * aggregate that looks obvious.
 *
 * Parameters: `$1` tenant, `$2` workspace, `$3` connection, `$4` since, `$5`
 * until, `$6` breakdown kind, `$7` entity level.
 */
const BREAKDOWN_AGGREGATE_SQL = `
  /* social-ad-breakdown:aggregate */
  SELECT fact.breakdown_key AS "breakdown_key",
         SUM(fact.spend)::text AS "spend",
         SUM(fact.impressions)::text AS "impressions",
         SUM(fact.clicks)::text AS "clicks",
         SUM(fact.link_clicks)::text AS "link_clicks",
         COUNT(DISTINCT fact.metric_date)::text AS "fact_days",
         MAX(fact.currency) AS "currency"
  FROM social_ad_breakdown_daily fact
  WHERE fact.tenant_id = $1
    AND fact.workspace_id = $2
    AND fact.connection_id = $3
    AND fact.breakdown_kind = $6
    AND fact.entity_level = $7
    AND fact.metric_date BETWEEN $4::date AND $5::date
  GROUP BY fact.breakdown_key
`;

/** A count column as a number, with null and unparsable text meaning zero. */
function readCount(value: string | null): number {
  if (value === null) return 0;

  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : 0;
}
