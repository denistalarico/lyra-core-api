import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';

import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import { SocialAdEntity } from '../entities/social-ad-entity.entity';
import { SocialAdMetricDailyEntity } from '../entities/social-ad-metric-daily.entity';
import { SocialAdSyncRunEntity } from '../entities/social-ad-sync-run.entity';
import { shiftDay } from '../sync/insights-window';
import { INSIGHTS_ENTITY_LEVELS } from '../sync/social-ad-sync-run.contract';
import type {
  SocialAdCampaignSort,
  SocialAdSortDirection,
} from '../views/social-ad-analytics-campaigns.view';
import { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import { SocialAnalyticsReadService } from './social-analytics-read.service';

/**
 * The analytics aggregation, against a real PostgreSQL.
 *
 * Everything this endpoint returns is the result of a `SUM … GROUP BY`-free
 * aggregate with three filters on it, and none of that is observable through a
 * mocked query builder: a stub for `getRawOne` asserts the fixture the test
 * itself wrote, not that the SQL sums the right rows. The failures worth
 * catching here are all database-shaped — summing two entity levels and doubling
 * every total, `SUM(bigint)` coming back as a numeric string that `BigInt()`
 * refuses, `BETWEEN` excluding its own endpoints, a scope filter that a literal
 * `null` silently turns off.
 *
 * Gated behind the same guard as every other PostgreSQL spec, inside one
 * transaction that is rolled back.
 */
const run = describePostgresIntegration();

run('Social analytics read against PostgreSQL', () => {
  let queryRunner: QueryRunner;
  let service: SocialAnalyticsReadService;

  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const connectionId = randomUUID();
  const otherTenantConnectionId = randomUUID();
  const clientConnectionId = randomUUID();
  const agencyClientId = randomUUID();

  /**
   * Connections used only by the chain assertions.
   *
   * Separate rows rather than reusing the main one: the whole point of those
   * tests is what the run log contains, and sharing a connection would make each
   * one depend on the runs the previous test inserted.
   */
  const chainNotStartedId = randomUUID();
  const chainInProgressId = randomUUID();
  const chainStalledId = randomUUID();
  const chainCompleteId = randomUUID();
  const disconnectedId = randomUUID();
  const twinConnectionId = randomUUID();

  const scope = { tenantId, workspaceId, agencyClientId: null };

  /**
   * One account-level fact. Values are deliberately un-round so that a double
   * count or a dropped row changes the total visibly.
   */
  function insertFact(input: {
    connectionId?: string;
    tenantId?: string;
    metricDate: string;
    entityLevel?: string;
    spend?: string;
    impressions?: string;
    clicks?: string;
    linkClicks?: string;
    leads?: string;
    conversions?: string;
    conversionValue?: string;
    videoViews?: string;
    reach?: string | null;
    isPartial?: boolean;
    currency?: string;
  }) {
    const reach = input.reach === undefined ? '300' : input.reach;

    return queryRunner.query(`
      INSERT INTO "social_ad_metrics_daily"
        ("tenant_id", "workspace_id", "connection_id", "provider", "source",
         "entity_level", "entity_external_id", "metric_date", "account_timezone",
         "currency", "attribution_setting", "spend", "impressions", "reach",
         "clicks", "link_clicks", "leads", "conversions", "conversion_value",
         "video_views", "is_partial")
      VALUES (
        '${input.tenantId ?? tenantId}', '${workspaceId}',
        '${input.connectionId ?? connectionId}', 'meta_ads', 'paid',
        '${input.entityLevel ?? 'account'}', 'act_probe_${input.entityLevel ?? 'account'}',
        '${input.metricDate}', 'America/Sao_Paulo',
        '${input.currency ?? 'BRL'}', 'account_default',
        ${input.spend ?? '10.500000'}, ${input.impressions ?? '1000'},
        ${reach === null ? 'NULL' : reach},
        ${input.clicks ?? '20'}, ${input.linkClicks ?? '15'},
        ${input.leads ?? '2'}, ${input.conversions ?? '1.000000'},
        ${input.conversionValue ?? '50.000000'}, ${input.videoViews ?? '100'},
        ${input.isPartial ?? false}
      )
    `);
  }

  /** One campaign-level fact, which is what the campaigns endpoint reads. */
  function insertCampaignFact(input: {
    connectionId?: string;
    campaignExternalId: string;
    metricDate: string;
    spend?: string;
    clicks?: string;
    leads?: string;
    isPartial?: boolean;
    attributionSetting?: string;
  }) {
    return queryRunner.query(`
      INSERT INTO "social_ad_metrics_daily"
        ("tenant_id", "workspace_id", "connection_id", "provider", "source",
         "entity_level", "entity_external_id", "campaign_external_id",
         "metric_date", "account_timezone", "currency", "attribution_setting",
         "spend", "impressions", "reach", "clicks", "link_clicks", "leads",
         "conversions", "conversion_value", "video_views", "is_partial")
      VALUES (
        '${tenantId}', '${workspaceId}',
        '${input.connectionId ?? connectionId}', 'meta_ads', 'paid',
        'campaign', '${input.campaignExternalId}', '${input.campaignExternalId}',
        '${input.metricDate}', 'America/Sao_Paulo', 'BRL',
        '${input.attributionSetting ?? 'account_default'}',
        ${input.spend ?? '10.000000'}, 1000, 300,
        ${input.clicks ?? '20'}, 15, ${input.leads ?? '2'},
        1.000000, 50.000000, 100, ${input.isPartial ?? false}
      )
    `);
  }

  /**
   * One ad-set fact, keyed by the ad set and parented to its campaign.
   *
   * Separate from `insertCampaignFact` because the two differ in exactly the
   * way that matters: here `entity_external_id` and `campaign_external_id` are
   * *different* objects, which is what lets a level-blind query mistake an ad
   * set's money for more of its campaign's.
   */
  function insertAdsetFact(input: {
    connectionId?: string;
    adsetExternalId: string;
    campaignExternalId: string;
    metricDate: string;
    spend?: string;
    clicks?: string;
    leads?: string;
    isPartial?: boolean;
  }) {
    return queryRunner.query(`
      INSERT INTO "social_ad_metrics_daily"
        ("tenant_id", "workspace_id", "connection_id", "provider", "source",
         "entity_level", "entity_external_id", "campaign_external_id",
         "metric_date", "account_timezone", "currency", "attribution_setting",
         "spend", "impressions", "reach", "clicks", "link_clicks", "leads",
         "conversions", "conversion_value", "video_views", "is_partial")
      VALUES (
        '${tenantId}', '${workspaceId}',
        '${input.connectionId ?? connectionId}', 'meta_ads', 'paid',
        'adset', '${input.adsetExternalId}', '${input.campaignExternalId}',
        '${input.metricDate}', 'America/Sao_Paulo', 'BRL', 'account_default',
        ${input.spend ?? '10.000000'}, 1000, 300,
        ${input.clicks ?? '20'}, 15, ${input.leads ?? '2'},
        1.000000, 50.000000, 100, ${input.isPartial ?? false}
      )
    `);
  }

  /** A mirrored campaign, under the full five-part identity. */
  function insertCampaignEntity(input: {
    connectionId?: string;
    externalId: string;
    name: string;
    status?: string;
    effectiveStatus?: string;
    objective?: string;
    archived?: boolean;
  }) {
    return queryRunner.query(`
      INSERT INTO "social_ad_entities"
        ("tenant_id", "workspace_id", "connection_id", "provider",
         "entity_level", "external_id", "name", "status", "effective_status",
         "objective", "archived_at")
      VALUES (
        '${tenantId}', '${workspaceId}',
        '${input.connectionId ?? connectionId}', 'meta_ads',
        'campaign', '${input.externalId}', '${input.name}',
        '${input.status ?? 'ACTIVE'}', '${input.effectiveStatus ?? 'ACTIVE'}',
        '${input.objective ?? 'OUTCOME_LEADS'}',
        ${input.archived ? 'now()' : 'NULL'}
      )
    `);
  }

  /** A settled sync run, for the freshness and backfill chain assertions. */
  /** A bare connection in the caller's scope, for a chain-shape fixture. */
  let connectionSeq = 0;

  function insertConnection(id: string) {
    connectionSeq += 1;

    return queryRunner.query(`
      INSERT INTO "social_ad_account_connections"
        ("id", "tenant_id", "workspace_id", "provider", "external_account_id",
         "timezone", "currency")
      VALUES
        ('${id}', '${tenantId}', '${workspaceId}', 'meta_ads',
         'act_chain_extra_${connectionSeq}', 'America/Sao_Paulo', 'BRL')
    `);
  }

  function insertRun(input: {
    connectionId: string;
    runKind: string;
    status: string;
    windowStart?: string | null;
    windowEnd?: string | null;
    finishedAt?: string | null;
    /**
     * What the run recorded that it read.
     *
     * Defaults to every level the insights pipeline currently ingests, so a
     * fixture that is not about coverage keeps meaning what it meant. Tests
     * that *are* about coverage pass the narrower list a pre-I3.4 run stored.
     */
    entityLevels?: readonly string[];
  }) {
    const start = input.windowStart ? `'${input.windowStart}'` : 'NULL';
    const end = input.windowEnd ? `'${input.windowEnd}'` : 'NULL';
    const finished = input.finishedAt ? `'${input.finishedAt}'` : 'NULL';
    const levels = JSON.stringify(input.entityLevels ?? INSIGHTS_ENTITY_LEVELS);

    return queryRunner.query(`
      INSERT INTO "social_ad_sync_runs"
        ("tenant_id", "workspace_id", "connection_id", "provider", "run_kind",
         "status", "window_start", "window_end", "idempotency_key",
         "entity_levels", "finished_at")
      VALUES (
        '${tenantId}', '${workspaceId}', '${input.connectionId}', 'meta_ads',
        '${input.runKind}', '${input.status}', ${start}, ${end},
        '${randomUUID()}', '${levels}'::jsonb, ${finished}
      )
    `);
  }

  const overview = (since: string, until: string, id = connectionId) =>
    service.overview({ ...scope, connectionId: id, since, until });

  const timeseries = (since: string, until: string, id = connectionId) =>
    service.timeseries({ ...scope, connectionId: id, since, until });

  const campaigns = (
    since: string,
    until: string,
    options: {
      id?: string;
      sort?: SocialAdCampaignSort;
      direction?: SocialAdSortDirection;
    } = {},
  ) =>
    service.campaigns({
      ...scope,
      connectionId: options.id ?? connectionId,
      since,
      until,
      sort: options.sort,
      direction: options.direction,
    });

  const freshness = (id = connectionId) =>
    service.freshness({ ...scope, connectionId: id });

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    queryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    await queryRunner.query(`
      INSERT INTO "social_ad_account_connections"
        ("id", "tenant_id", "workspace_id", "provider", "external_account_id",
         "timezone", "currency")
      VALUES
        ('${connectionId}', '${tenantId}', '${workspaceId}', 'meta_ads',
         'act_probe_main', 'America/Sao_Paulo', 'BRL'),
        ('${otherTenantConnectionId}', '${randomUUID()}', '${workspaceId}',
         'meta_ads', 'act_probe_other', 'America/Sao_Paulo', 'BRL'),
        ('${clientConnectionId}', '${tenantId}', '${workspaceId}', 'meta_ads',
         'act_probe_client', 'America/Sao_Paulo', 'BRL'),
        ('${chainNotStartedId}', '${tenantId}', '${workspaceId}', 'meta_ads',
         'act_chain_none', 'America/Sao_Paulo', 'BRL'),
        ('${chainInProgressId}', '${tenantId}', '${workspaceId}', 'meta_ads',
         'act_chain_running', 'America/Sao_Paulo', 'BRL'),
        ('${chainStalledId}', '${tenantId}', '${workspaceId}', 'meta_ads',
         'act_chain_stalled', 'America/Sao_Paulo', 'BRL'),
        ('${chainCompleteId}', '${tenantId}', '${workspaceId}', 'meta_ads',
         'act_chain_done', 'America/Sao_Paulo', 'BRL'),
        ('${twinConnectionId}', '${tenantId}', '${workspaceId}', 'meta_ads',
         'act_probe_twin', 'America/Sao_Paulo', 'BRL')
    `);

    // A connection whose credential was revoked but whose history remains.
    await queryRunner.query(`
      INSERT INTO "social_ad_account_connections"
        ("id", "tenant_id", "workspace_id", "provider", "external_account_id",
         "timezone", "currency", "connection_status", "credential_removed_at")
      VALUES
        ('${disconnectedId}', '${tenantId}', '${workspaceId}', 'meta_ads',
         'act_probe_gone', 'America/Sao_Paulo', 'BRL', 'disconnected', now())
    `);

    await queryRunner.query(`
      UPDATE "social_ad_account_connections"
         SET "agency_client_id" = '${agencyClientId}'
       WHERE "id" = '${clientConnectionId}'
    `);

    service = new SocialAnalyticsReadService(
      queryRunner.manager.getRepository(SocialAdAccountConnectionEntity),
      queryRunner.manager.getRepository(SocialAdMetricDailyEntity),
      queryRunner.manager.getRepository(SocialAdEntity),
      queryRunner.manager.getRepository(SocialAdSyncRunEntity),
      // The real config, so the chain is measured against the same 90/7 plan
      // production uses rather than numbers invented for the test.
      new SocialAdSyncConfigService(),
    );
  });

  afterAll(async () => {
    if (queryRunner?.isTransactionActive)
      await queryRunner.rollbackTransaction();
    await queryRunner?.release();
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  describe('an account with no facts at all', () => {
    it('answers zeros and null KPIs rather than failing', async () => {
      const result = await overview('2026-01-01', '2026-01-07');

      expect(result.current.spend).toBe('0.000000');
      expect(result.current.impressions).toBe('0');
      expect(result.current.ctr).toBeNull();
      expect(result.current.cpc).toBeNull();
      expect(result.hasPartialData).toBe(false);
      expect(result.lastFactDate).toBeNull();
    });
  });

  describe('aggregation', () => {
    beforeAll(async () => {
      // Three settled days in the current period.
      await insertFact({ metricDate: '2026-08-21', spend: '10.500000' });
      await insertFact({ metricDate: '2026-08-22', spend: '20.250000' });
      await insertFact({ metricDate: '2026-08-23', spend: '30.000000' });

      // A campaign-level row for the same day, carrying the same money. If the
      // aggregate did not filter by level, every total below would double.
      await insertFact({
        metricDate: '2026-08-21',
        entityLevel: 'campaign',
        spend: '10.500000',
      });

      // And an ad-set row for that same day and that same money. I3.4 began
      // ingesting this level, so from now on the table holds three rows
      // describing one day's spend at three grains. A read that forgot its
      // `entity_level` filter would now *triple* rather than double — a
      // regression that would look like a real increase in client spend.
      await insertFact({
        metricDate: '2026-08-21',
        entityLevel: 'adset',
        spend: '10.500000',
      });
    });

    it('sums only the account level, never account plus campaign plus ad set', async () => {
      const result = await overview('2026-08-21', '2026-08-23');

      // 10.5 + 20.25 + 30 — neither the campaign nor the ad-set row appears.
      expect(result.current.spend).toBe('60.750000');
      expect(result.current.impressions).toBe('3000');
    });

    it('includes both endpoints of the range', async () => {
      // A BETWEEN that excluded its bounds would return only 2026-08-22.
      const result = await overview('2026-08-21', '2026-08-23');

      expect(result.current.clicks).toBe('60');
    });

    it('excludes days outside the range', async () => {
      const result = await overview('2026-08-22', '2026-08-22');

      expect(result.current.spend).toBe('20.250000');
    });

    it('derives KPIs from the summed totals, not per day', async () => {
      const result = await overview('2026-08-21', '2026-08-23');

      // 60 clicks / 3000 impressions = 2%, and 60.75 / 60 per click.
      expect(result.current.ctr).toBe('2.000000');
      expect(result.current.cpc).toBe('1.012500');
    });

    it('reports the most recent day held, beyond the period', async () => {
      const result = await overview('2026-08-21', '2026-08-21');

      expect(result.lastFactDate).toBe('2026-08-23');
    });

    it('returns the account currency and timezone', async () => {
      const result = await overview('2026-08-21', '2026-08-23');

      expect(result.currency).toBe('BRL');
      expect(result.timezone).toBe('America/Sao_Paulo');
    });
  });

  describe('period comparison', () => {
    beforeAll(async () => {
      // The three days immediately before the 08-21→08-23 period.
      await insertFact({ metricDate: '2026-08-18', spend: '10.000000' });
      await insertFact({ metricDate: '2026-08-19', spend: '10.000000' });
      await insertFact({ metricDate: '2026-08-20', spend: '10.000000' });
    });

    it('derives the adjacent window of equal length', async () => {
      const result = await overview('2026-08-21', '2026-08-23');

      expect(result.comparisonPeriod).toEqual({
        since: '2026-08-18',
        until: '2026-08-20',
      });
      expect(result.previous.spend).toBe('30.000000');
    });

    it('reports movement between the two windows', async () => {
      const result = await overview('2026-08-21', '2026-08-23');

      // 60.75 against 30.00.
      expect(result.change.spend.absolute).toBe('30.750000');
      expect(result.change.spend.percent).toBe('102.500000');
    });

    it('reports a null percent when the previous window is empty', async () => {
      // 2026-08-18 is the earliest fact, so this period's predecessor
      // (2026-08-17) holds nothing — a campaign's first period.
      const result = await overview('2026-08-18', '2026-08-18');

      expect(result.previous.spend).toBe('0.000000');
      expect(result.change.spend.absolute).toBe('10.000000');
      expect(result.change.spend.percent).toBeNull();
    });
  });

  describe('partial data', () => {
    beforeAll(async () => {
      await insertFact({
        metricDate: '2026-08-27',
        spend: '5.000000',
        isPartial: true,
      });
    });

    it('flags a period containing a provisional day', async () => {
      const result = await overview('2026-08-27', '2026-08-27');

      expect(result.hasPartialData).toBe(true);
    });

    it('does not flag a period of settled days only', async () => {
      const result = await overview('2026-08-21', '2026-08-23');

      expect(result.hasPartialData).toBe(false);
    });

    it('ignores partiality in the comparison window', async () => {
      // 2026-08-28 compares against 2026-08-27, which is partial. The flag
      // describes the number being shown, not its historical baseline.
      const result = await overview('2026-08-28', '2026-08-28');

      expect(result.hasPartialData).toBe(false);
    });
  });

  describe('reach', () => {
    it('returns the stored figure for a single day', async () => {
      const result = await overview('2026-08-22', '2026-08-22');

      expect(result.current.reach).toBe('300');
      expect(result.current.reachGranularity).toBe('daily');
    });

    it('refuses to sum reach across days', async () => {
      // 300 + 300 + 300 = 900 would be wrong: anyone reached on two days is one
      // person, and no local arithmetic undoes Meta's de-duplication.
      const result = await overview('2026-08-21', '2026-08-23');

      expect(result.current.reach).toBeNull();
      expect(result.current.reachGranularity).toBe('daily');
    });
  });

  describe('scope', () => {
    it('refuses a connection in another tenant as not found', async () => {
      await expect(
        overview('2026-08-21', '2026-08-23', otherTenantConnectionId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a client connection while in agency context', async () => {
      // The agency scope passes `agencyClientId: null`, which must match only
      // rows where the column IS NULL. A literal null would be read by TypeORM
      // as "no filter" and would return this row.
      await expect(
        overview('2026-08-21', '2026-08-23', clientConnectionId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('never sums facts belonging to another connection', async () => {
      await insertFact({
        connectionId: clientConnectionId,
        metricDate: '2026-08-22',
        spend: '999.000000',
      });

      const result = await overview('2026-08-22', '2026-08-22');

      expect(result.current.spend).toBe('20.250000');
    });
  });

  describe('precision', () => {
    it('sums money exactly across many days', async () => {
      const period = { since: '2027-01-01', until: '2027-01-10' };

      for (let day = 1; day <= 10; day += 1) {
        await insertFact({
          metricDate: `2027-01-${String(day).padStart(2, '0')}`,
          spend: '0.100000',
        });
      }

      const result = await overview(period.since, period.until);

      // Ten times 0.1 through a double is 0.9999999999999999.
      expect(result.current.spend).toBe('1.000000');
    });

    it('reads a count beyond the safe integer ceiling without rounding', async () => {
      await insertFact({
        metricDate: '2027-02-01',
        impressions: '9007199254740993',
        clicks: '0',
      });

      const result = await overview('2027-02-01', '2027-02-01');

      expect(result.current.impressions).toBe('9007199254740993');
    });
  });

  describe('timeseries', () => {
    it('returns one ascending point per calendar day', async () => {
      const result = await timeseries('2026-08-21', '2026-08-23');

      expect(result.points.map((point) => point.date)).toEqual([
        '2026-08-21',
        '2026-08-22',
        '2026-08-23',
      ]);
      expect(result.seriesMode).toBe('continuous');
    });

    it('marks an unobserved day with nulls rather than zeros', async () => {
      // 2026-08-24 and 2026-08-25 have no facts.
      const result = await timeseries('2026-08-23', '2026-08-25');
      const gap = result.points[1];

      expect(gap.date).toBe('2026-08-24');
      expect(gap.hasData).toBe(false);
      // Zeros here would draw a confident zero where the truth is "unknown".
      expect(gap.spend).toBeNull();
      expect(gap.impressions).toBeNull();
      expect(gap.reach).toBeNull();
      expect(gap.ctr).toBeNull();
      expect(result.observedDays).toBe(1);
    });

    it('reports a day that was read as having data', async () => {
      const result = await timeseries('2026-08-22', '2026-08-22');
      const point = result.points[0];

      expect(point.hasData).toBe(true);
      expect(point.spend).toBe('20.250000');
      expect(point.impressions).toBe('1000');
    });

    it('charts one point per day, not one per level', async () => {
      // §19 for the chart. 2026-08-21 carries an account row, a campaign row
      // and (since I3.4) an ad-set row, all with the same 10.50. A series that
      // lost its `entity_level` filter would plot 31.50 for that day and, worse,
      // would still look like a plausible chart.
      const result = await timeseries('2026-08-21', '2026-08-21');

      expect(result.points).toHaveLength(1);
      expect(result.points[0].spend).toBe('10.500000');
      expect(result.points[0].impressions).toBe('1000');
    });

    it('returns the real daily reach, the one grain where it is honest', async () => {
      const result = await timeseries('2026-08-22', '2026-08-22');

      expect(result.points[0].reach).toBe('300');
    });

    it('derives KPIs per day rather than over the period', async () => {
      const result = await timeseries('2026-08-21', '2026-08-23');

      // Each day is 20 clicks over 1000 impressions.
      expect(result.points.map((point) => point.ctr)).toEqual([
        '2.000000',
        '2.000000',
        '2.000000',
      ]);
      // Spend differs per day, so CPC must too.
      expect(result.points[0].cpc).toBe('0.525000');
      expect(result.points[1].cpc).toBe('1.012500');
    });

    it('sums only account-level facts', async () => {
      // 2026-08-21 also holds a campaign-level row of the same money.
      const result = await timeseries('2026-08-21', '2026-08-21');

      expect(result.points[0].spend).toBe('10.500000');
    });

    it('flags the provisional day and only that day', async () => {
      const result = await timeseries('2026-08-26', '2026-08-27');

      expect(result.points[0].isPartial).toBe(false);
      expect(result.points[0].hasData).toBe(false);
      expect(result.points[1].isPartial).toBe(true);
      expect(result.hasPartialData).toBe(true);
    });

    it('refuses a connection outside the caller scope', async () => {
      await expect(
        timeseries('2026-08-21', '2026-08-23', otherTenantConnectionId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('campaigns', () => {
    beforeAll(async () => {
      await insertCampaignEntity({
        externalId: 'camp-big',
        name: 'Big spender',
        objective: 'OUTCOME_SALES',
      });
      await insertCampaignEntity({
        externalId: 'camp-small',
        name: 'Small spender',
        status: 'PAUSED',
        effectiveStatus: 'CAMPAIGN_PAUSED',
      });
      await insertCampaignEntity({
        externalId: 'camp-old',
        name: 'Archived campaign',
        archived: true,
      });

      // The same external id under a different connection, with a different
      // name: if the identity join were by external_id alone, this name could
      // surface for the main connection's spend.
      await insertCampaignEntity({
        connectionId: twinConnectionId,
        externalId: 'camp-big',
        name: 'Another tenant campaign',
      });

      await insertCampaignFact({
        campaignExternalId: 'camp-big',
        metricDate: '2026-09-01',
        spend: '100.000000',
        clicks: '50',
        leads: '10',
      });
      await insertCampaignFact({
        campaignExternalId: 'camp-big',
        metricDate: '2026-09-02',
        spend: '50.000000',
        clicks: '25',
        leads: '5',
      });
      await insertCampaignFact({
        campaignExternalId: 'camp-small',
        metricDate: '2026-09-01',
        spend: '10.000000',
        clicks: '40',
        leads: '1',
      });
      await insertCampaignFact({
        campaignExternalId: 'camp-old',
        metricDate: '2026-09-01',
        spend: '30.000000',
        clicks: '5',
        leads: '0',
      });
      // A campaign with facts only outside the tested window.
      await insertCampaignFact({
        campaignExternalId: 'camp-absent',
        metricDate: '2026-10-15',
        spend: '999.000000',
      });

      /**
       * Two ad-set rows belonging to `camp-big`, carrying that campaign's own
       * money broken down.
       *
       * This is what the table actually looks like after I3.4, and it is the
       * shape that makes the campaign table's `entity_level = 'campaign'`
       * filter load-bearing rather than incidental: these rows share the
       * campaign's `campaign_external_id`, so a query that grouped by that
       * column without pinning the level would add each campaign's spend to
       * its own ad sets' — reporting 300 where the truth is 150.
       */
      await insertAdsetFact({
        adsetExternalId: 'adset-big-a',
        campaignExternalId: 'camp-big',
        metricDate: '2026-09-01',
        spend: '60.000000',
        clicks: '30',
        leads: '6',
      });
      await insertAdsetFact({
        adsetExternalId: 'adset-big-b',
        campaignExternalId: 'camp-big',
        metricDate: '2026-09-01',
        spend: '40.000000',
        clicks: '20',
        leads: '4',
      });
    });

    it('aggregates each campaign across the period', async () => {
      const result = await campaigns('2026-09-01', '2026-09-02');
      const big = result.items.find((item) => item.externalId === 'camp-big');

      expect(big?.spend).toBe('150.000000');
      expect(big?.clicks).toBe('75');
      expect(big?.leads).toBe('15');
      // 150 / 15
      expect(big?.cpl).toBe('10.000000');
    });

    it('ignores the ad-set rows that roll up into the same campaign', async () => {
      // §19, stated directly. The ad sets of `camp-big` hold 100.00 between
      // them on 2026-09-01; the campaign table must still report the campaign's
      // own 150.00 for the period, not 250.00.
      const result = await campaigns('2026-09-01', '2026-09-02');
      const big = result.items.find((item) => item.externalId === 'camp-big');

      expect(big?.spend).toBe('150.000000');
    });

    it('does not list an ad set as though it were a campaign', async () => {
      // The rows exist and share a `campaign_external_id`; nothing about them
      // should reach a table whose grain is the campaign.
      const result = await campaigns('2026-09-01', '2026-09-02');

      expect(result.items.map((item) => item.externalId)).not.toContain(
        'adset-big-a',
      );
    });

    it('carries name, status, effective status and objective', async () => {
      const result = await campaigns('2026-09-01', '2026-09-02');
      const small = result.items.find(
        (item) => item.externalId === 'camp-small',
      );

      expect(small?.name).toBe('Small spender');
      expect(small?.status).toBe('PAUSED');
      expect(small?.effectiveStatus).toBe('CAMPAIGN_PAUSED');
      expect(small?.objective).toBe('OUTCOME_LEADS');
    });

    it('includes an archived campaign that spent in the period', async () => {
      const result = await campaigns('2026-09-01', '2026-09-02');
      const archived = result.items.find(
        (item) => item.externalId === 'camp-old',
      );

      // Hiding it would make this page's total disagree with the overview's.
      expect(archived?.archived).toBe(true);
      expect(archived?.spend).toBe('30.000000');
    });

    it('never takes a name from another connection with the same id', async () => {
      const result = await campaigns('2026-09-01', '2026-09-02');
      const big = result.items.find((item) => item.externalId === 'camp-big');

      // Meta campaign ids are unique per Business, not globally.
      expect(big?.name).toBe('Big spender');
      expect(big?.name).not.toBe('Another tenant campaign');
    });

    it('keeps a campaign whose hierarchy row was never mirrored', async () => {
      const result = await campaigns('2026-10-15', '2026-10-15');
      const absent = result.items.find(
        (item) => item.externalId === 'camp-absent',
      );

      // Present with its spend and a null name — dropping it would understate
      // the account's total.
      expect(absent).toBeDefined();
      expect(absent?.name).toBeNull();
      expect(absent?.spend).toBe('999.000000');
    });

    it('omits a campaign with no delivery in the period', async () => {
      const result = await campaigns('2026-09-01', '2026-09-02');

      expect(
        result.items.some((item) => item.externalId === 'camp-absent'),
      ).toBe(false);
    });

    it('defaults to spend descending', async () => {
      const result = await campaigns('2026-09-01', '2026-09-02');

      expect(result.sort).toBe('spend');
      expect(result.direction).toBe('desc');
      expect(result.items.map((item) => item.externalId)).toEqual([
        'camp-big',
        'camp-old',
        'camp-small',
      ]);
    });

    it('sorts by a derived KPI in SQL, agreeing with the reported value', async () => {
      const result = await campaigns('2026-09-01', '2026-09-02', {
        sort: 'cpc',
        direction: 'asc',
      });

      // camp-small: 10/40 = 0.25; camp-big: 150/75 = 2; camp-old: 30/5 = 6.
      expect(result.items.map((item) => item.externalId)).toEqual([
        'camp-small',
        'camp-big',
        'camp-old',
      ]);
      expect(result.items[0].cpc).toBe('0.250000');
    });

    it('sorts ascending when asked', async () => {
      const result = await campaigns('2026-09-01', '2026-09-02', {
        sort: 'spend',
        direction: 'asc',
      });

      expect(result.items[0].externalId).toBe('camp-small');
    });

    it('returns null reach for a multi-day period', async () => {
      const result = await campaigns('2026-09-01', '2026-09-02');
      const big = result.items.find((item) => item.externalId === 'camp-big');

      expect(big?.reach).toBeNull();
    });

    it('returns the daily reach for a single-day period', async () => {
      const result = await campaigns('2026-09-01', '2026-09-01');
      const big = result.items.find((item) => item.externalId === 'camp-big');

      expect(big?.reach).toBe('300');
    });

    it('flags a campaign whose period contains a provisional day', async () => {
      await insertCampaignFact({
        campaignExternalId: 'camp-live',
        metricDate: '2026-09-03',
        isPartial: true,
      });

      const result = await campaigns('2026-09-03', '2026-09-03');
      const live = result.items.find((item) => item.externalId === 'camp-live');

      expect(live?.hasPartialData).toBe(true);
    });

    it('ignores facts measured under another attribution setting', async () => {
      await insertCampaignFact({
        campaignExternalId: 'camp-big',
        metricDate: '2026-09-04',
        spend: '777.000000',
        attributionSetting: 'seven_day_click',
      });

      const result = await campaigns('2026-09-04', '2026-09-04');

      // A second way of measuring the same delivery is a different fact, not
      // more spend.
      expect(result.items.some((item) => item.externalId === 'camp-big')).toBe(
        false,
      );
    });

    it('refuses a connection outside the caller scope', async () => {
      await expect(
        campaigns('2026-09-01', '2026-09-02', { id: otherTenantConnectionId }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('freshness', () => {
    it('reports no chain when the connection has no backfill run', async () => {
      const result = await freshness(chainNotStartedId);

      expect(result.backfill.status).toBe('not_started');
      expect(result.backfill.anchor).toBeNull();
      expect(result.backfill.complete).toBe(false);
      expect(result.backfill.stalled).toBe(false);
    });

    it('reports a chain in progress and the anchor it started with', async () => {
      await insertRun({
        connectionId: chainInProgressId,
        runKind: 'backfill',
        status: 'succeeded',
        windowStart: '2026-08-13',
        windowEnd: '2026-08-19',
      });
      await insertRun({
        connectionId: chainInProgressId,
        runKind: 'backfill',
        status: 'queued',
        windowStart: '2026-08-06',
        windowEnd: '2026-08-12',
      });

      const result = await freshness(chainInProgressId);

      expect(result.backfill.status).toBe('in_progress');
      expect(result.backfill.anchor).toBe('2026-08-19');
      expect(result.backfill.chunksTotal).toBe(13);
      expect(result.backfill.chunksSucceeded).toBe(1);
      expect(result.backfill.chunksInFlight).toBe(1);
    });

    it('keeps the original anchor rather than recomputing from today', async () => {
      const result = await freshness(chainInProgressId);

      // The chain above is anchored well in the past. An anchor derived from
      // the current date would slide every remaining chunk boundary.
      expect(result.backfill.anchor).toBe('2026-08-19');
    });

    it('reports a stalled chain when the first uncovered chunk gave up', async () => {
      await insertRun({
        connectionId: chainStalledId,
        runKind: 'backfill',
        status: 'succeeded',
        windowStart: '2026-08-13',
        windowEnd: '2026-08-19',
      });
      await insertRun({
        connectionId: chainStalledId,
        runKind: 'backfill',
        status: 'dead_letter',
        windowStart: '2026-08-06',
        windowEnd: '2026-08-12',
      });

      const result = await freshness(chainStalledId);

      expect(result.backfill.status).toBe('stalled');
      expect(result.backfill.stalled).toBe(true);
      expect(result.backfill.complete).toBe(false);
    });

    it('lets a later success outrank an earlier failure', async () => {
      // The resume endpoint's whole purpose, seen from the read side.
      await insertRun({
        connectionId: chainStalledId,
        runKind: 'backfill',
        status: 'succeeded',
        windowStart: '2026-08-06',
        windowEnd: '2026-08-12',
      });

      const result = await freshness(chainStalledId);

      expect(result.backfill.status).toBe('in_progress');
      expect(result.backfill.chunksSucceeded).toBe(2);
    });

    it('reports a complete chain when every chunk has a succeeded run', async () => {
      // Thirteen chunks of the 90-day plan anchored at 2026-08-19.
      const anchor = '2026-08-19';
      let until = anchor;

      for (let index = 0; index < 13; index += 1) {
        const days = index === 12 ? 6 : 7;
        const since = shiftDay(until, -(days - 1));

        await insertRun({
          connectionId: chainCompleteId,
          runKind: 'backfill',
          status: 'succeeded',
          windowStart: since,
          windowEnd: until,
        });

        until = shiftDay(since, -1);
      }

      const result = await freshness(chainCompleteId);

      expect(result.backfill.status).toBe('complete');
      expect(result.backfill.complete).toBe(true);
      expect(result.backfill.chunksSucceeded).toBe(13);
      expect(result.backfill.anchor).toBe(anchor);
    });

    /**
     * §24, from the read side.
     *
     * The planner's own answer is asserted in its unit spec. This is the other
     * half: the freshness card computes chain state through the *same*
     * `resolveChunkState`, over its own query, and the two must not disagree.
     * A card reading "complete" while the planner was still fetching ad-set
     * history is precisely the silent hole this design exists to prevent.
     */
    it('does not report a pre-ad-set chain as complete', async () => {
      const legacyId = randomUUID();

      await insertConnection(legacyId);

      const anchor = '2026-08-19';
      let until = anchor;

      for (let index = 0; index < 13; index += 1) {
        const days = index === 12 ? 6 : 7;
        const since = shiftDay(until, -(days - 1));

        await insertRun({
          connectionId: legacyId,
          runKind: 'backfill',
          status: 'succeeded',
          windowStart: since,
          windowEnd: until,
          // The exact shape production holds: thirteen succeeded chunks,
          // every one of them recorded before ad-set insights existed.
          entityLevels: ['account', 'campaign'],
        });

        until = shiftDay(since, -1);
      }

      const result = await freshness(legacyId);

      expect(result.backfill.status).toBe('in_progress');
      expect(result.backfill.complete).toBe(false);
      // Nothing is covered: every chunk needs re-reading at the new level.
      expect(result.backfill.chunksSucceeded).toBe(0);
      // The anchor still comes from those runs, so the re-read lands on the
      // original boundaries rather than a plan cut from today.
      expect(result.backfill.anchor).toBe(anchor);
    });

    it('reports complete once the narrow chain has been re-read wider', async () => {
      const upgradedId = randomUUID();

      await insertConnection(upgradedId);

      const anchor = '2026-08-19';
      let until = anchor;

      for (let index = 0; index < 13; index += 1) {
        const days = index === 12 ? 6 : 7;
        const since = shiftDay(until, -(days - 1));

        // The original narrow run stays in the log — nothing deletes history —
        // and the wider one is what certifies the window.
        await insertRun({
          connectionId: upgradedId,
          runKind: 'backfill',
          status: 'succeeded',
          windowStart: since,
          windowEnd: until,
          entityLevels: ['account', 'campaign'],
        });
        await insertRun({
          connectionId: upgradedId,
          runKind: 'backfill',
          status: 'succeeded',
          windowStart: since,
          windowEnd: until,
        });

        until = shiftDay(since, -1);
      }

      const result = await freshness(upgradedId);

      expect(result.backfill.status).toBe('complete');
      expect(result.backfill.chunksSucceeded).toBe(13);
    });

    it('reports the newest closed and partial days separately', async () => {
      const result = await freshness();

      // The main connection holds settled days through 2026-08-23, plus a
      // provisional 2026-08-27 and later precision fixtures.
      expect(result.metrics.latestPartialMetricDate).toBe('2026-08-27');
      expect(result.metrics.latestClosedMetricDate).toBe('2027-02-01');
      expect(result.metrics.latestMetricDate).toBe('2027-02-01');
      expect(result.hasPartialData).toBe(true);
      expect(result.metrics.latestMetricsSyncedAt).not.toBeNull();
    });

    it('reports no metrics for a connection that has none', async () => {
      const result = await freshness(chainNotStartedId);

      expect(result.metrics.latestMetricDate).toBeNull();
      expect(result.metrics.latestClosedMetricDate).toBeNull();
      expect(result.metrics.latestPartialMetricDate).toBeNull();
      expect(result.hasPartialData).toBe(false);
    });

    it('reports the latest successful daily and intraday runs', async () => {
      await insertRun({
        connectionId: chainNotStartedId,
        runKind: 'daily',
        status: 'succeeded',
        finishedAt: '2026-08-27T09:00:00Z',
      });
      await insertRun({
        connectionId: chainNotStartedId,
        runKind: 'intraday',
        status: 'succeeded',
        finishedAt: '2026-08-27T18:00:00Z',
      });
      // A failed daily run must not be reported as the latest successful one.
      await insertRun({
        connectionId: chainNotStartedId,
        runKind: 'daily',
        status: 'failed',
        finishedAt: '2026-08-27T21:00:00Z',
      });

      const result = await freshness(chainNotStartedId);

      expect(result.runs.latestSuccessfulDailyRun).toBe(
        '2026-08-27T09:00:00.000Z',
      );
      expect(result.runs.latestSuccessfulIntradayRun).toBe(
        '2026-08-27T18:00:00.000Z',
      );
    });

    it('refuses a connection outside the caller scope', async () => {
      await expect(freshness(otherTenantConnectionId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('a disconnected connection', () => {
    beforeAll(async () => {
      await insertFact({
        connectionId: disconnectedId,
        metricDate: '2026-07-10',
        spend: '42.000000',
      });
      await insertCampaignFact({
        connectionId: disconnectedId,
        campaignExternalId: 'camp-history',
        metricDate: '2026-07-10',
        spend: '42.000000',
      });
    });

    /**
     * The reason this read path does not use `SocialAdCredentialResolver`.
     *
     * The resolver refuses a connection whose credential was removed, which is
     * correct for a sync and would be wrong here: the stored history is still
     * true, still the client's, and still what somebody needs while they sort
     * the credential out.
     */
    it('still answers the overview from stored history', async () => {
      const result = await service.overview({
        ...scope,
        connectionId: disconnectedId,
        since: '2026-07-10',
        until: '2026-07-10',
      });

      expect(result.current.spend).toBe('42.000000');
    });

    it('still answers the timeseries', async () => {
      const result = await timeseries(
        '2026-07-10',
        '2026-07-10',
        disconnectedId,
      );

      expect(result.points[0].hasData).toBe(true);
      expect(result.points[0].spend).toBe('42.000000');
    });

    it('still answers campaigns', async () => {
      const result = await campaigns('2026-07-10', '2026-07-10', {
        id: disconnectedId,
      });

      expect(result.items[0].spend).toBe('42.000000');
    });

    it('reports the status as data rather than as a refusal', async () => {
      const result = await freshness(disconnectedId);

      expect(result.connectionStatus).toBe('disconnected');
      expect(result.metrics.latestMetricDate).toBe('2026-07-10');
    });

    it('still appears in the picker, labelled as no longer updating', async () => {
      const items = await service.listConnections(scope);
      const row = items.find((item) => item.id === disconnectedId);

      // Hiding it would make its history unreachable from the dashboard, which
      // is the opposite of why the read path tolerates a dead credential.
      expect(row).toBeDefined();
      expect(row?.connectionStatus).toBe('disconnected');
    });
  });

  describe('the analytics connection picker', () => {
    it('lists the connections of the caller scope', async () => {
      const items = await service.listConnections(scope);
      const ids = items.map((item) => item.id);

      expect(ids).toContain(connectionId);
      expect(ids).toContain(twinConnectionId);
    });

    it('never lists a connection from another tenant', async () => {
      const items = await service.listConnections(scope);

      expect(items.map((item) => item.id)).not.toContain(
        otherTenantConnectionId,
      );
    });

    it('never lists a client connection while in agency context', async () => {
      const items = await service.listConnections(scope);

      // The agency scope passes `agencyClientId: null`, which must match only
      // rows where the column IS NULL rather than every client's row.
      expect(items.map((item) => item.id)).not.toContain(clientConnectionId);
    });

    it('lists the client connection only under that client scope', async () => {
      const items = await service.listConnections({
        tenantId,
        workspaceId,
        agencyClientId,
      });

      expect(items.map((item) => item.id)).toEqual([clientConnectionId]);
    });

    it('masks the ad account id and exposes no credential state', async () => {
      const items = await service.listConnections(scope);
      const row = items.find((item) => item.id === connectionId);

      // `act_probe_main` is short enough that masking keeps the last four
      // characters — what matters is that the raw value never appears.
      expect(row?.maskedAccountId).not.toBe('act_probe_main');
      expect(row?.maskedAccountId).toContain('•');

      for (const field of [
        'accessTokenEncrypted',
        'hasCredential',
        'tokenExpiresAt',
        'scopes',
        'externalAccountId',
      ]) {
        expect(row).not.toHaveProperty(field);
      }
    });

    it('omits a connection that never reached an ad account', async () => {
      const abandonedId = randomUUID();

      // An OAuth attempt the operator abandoned: stored, in scope, and with no
      // `external_account_id` it will never acquire. It cannot hold a single
      // fact, so listing it would offer an unnamed account that reports zeros
      // forever.
      await queryRunner.query(`
        INSERT INTO "social_ad_account_connections"
          ("id", "tenant_id", "workspace_id", "provider", "connection_status")
        VALUES
          ('${abandonedId}', '${tenantId}', '${workspaceId}', 'meta_ads', 'error')
      `);

      const items = await service.listConnections(scope);

      expect(items.map((item) => item.id)).not.toContain(abandonedId);
      // The settings screen still shows it — resolving a failed attempt is
      // that screen's job, and this filter must not be read as hiding it.
      expect(items.length).toBeGreaterThan(0);
    });

    it('carries the currency and timezone the dashboard formats with', async () => {
      const items = await service.listConnections(scope);
      const row = items.find((item) => item.id === connectionId);

      expect(row?.currency).toBe('BRL');
      expect(row?.timezone).toBe('America/Sao_Paulo');
    });
  });
});
