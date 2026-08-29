import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import {
  assertAggregable,
  requireIntelligenceScope,
  type IntelligenceFactSet,
  type IntelligenceGrain,
} from '../../../common/intelligence';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import { SocialAdEntity } from '../entities/social-ad-entity.entity';
import { SocialAdMetricDailyEntity } from '../entities/social-ad-metric-daily.entity';
import { SocialAdSyncRunEntity } from '../entities/social-ad-sync-run.entity';
import { SocialAdSyncConfigService } from '../services/social-ad-sync-config.service';
import { SocialAnalyticsReadService } from '../services/social-analytics-read.service';
import { SocialPaidMediaIntelligenceAdapter } from './social-paid-media-intelligence.adapter';

const run = describePostgresIntegration();

/**
 * The paid media adapter against real rows.
 *
 * The unit spec proves the adapter translates what the read service returns.
 * This proves the read service returns the right thing *through the adapter* —
 * which is a different claim, and the one that would actually be wrong in
 * production. Every failure worth catching here is database-shaped: a campaign
 * row summed into an account total and doubling every figure, a second
 * attribution window added to the first, a `SUM(bigint)` arriving as a numeric
 * string, a scope filter that a literal `null` silently disables.
 *
 * The last test is the one that matters most for trust: the same numbers, read
 * through the shipped Analytics API and through the adapter, must be identical.
 * A fact port that disagreed with the dashboard would make both untrustworthy.
 */
run('Social paid media intelligence adapter against PostgreSQL', () => {
  let queryRunner: QueryRunner;
  let reads: SocialAnalyticsReadService;
  let adapter: SocialPaidMediaIntelligenceAdapter;

  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const agencyClientId = randomUUID();

  const connectionId = randomUUID();
  const clientConnectionId = randomUUID();
  const otherTenantConnectionId = randomUUID();
  const otherWorkspaceConnectionId = randomUUID();
  const disconnectedId = randomUUID();
  const volumeConnectionId = randomUUID();

  const fetch = (
    options: {
      grain?: IntelligenceGrain;
      since?: string;
      until?: string;
      subjectId?: string;
      client?: string | null;
      tenant?: string;
      workspace?: string;
    } = {},
  ): Promise<IntelligenceFactSet> =>
    adapter.fetch({
      scope: requireIntelligenceScope({
        tenantId: options.tenant ?? tenantId,
        workspaceId: options.workspace ?? workspaceId,
        agencyClientId: options.client ?? null,
      }),
      window: {
        since: options.since ?? '2026-08-01',
        until: options.until ?? '2026-08-31',
      },
      grain: options.grain ?? 'period',
      subjectId: options.subjectId ?? connectionId,
    });

  const valueOf = (set: IntelligenceFactSet, key: string, date?: string) =>
    set.facts.find(
      (fact) =>
        fact.metricKey === key &&
        (date === undefined || fact.dimensions.date === date),
    )?.value;

  /** One fact row, with every discriminator explicit so nothing is implied. */
  function insertFact(input: {
    connectionId?: string;
    tenantId?: string;
    workspaceId?: string;
    metricDate: string;
    entityLevel?: string;
    source?: string;
    attributionSetting?: string;
    spend?: string;
    impressions?: string;
    clicks?: string;
    leads?: string;
    reach?: string | null;
    isPartial?: boolean;
  }) {
    const reach = input.reach === undefined ? '300' : input.reach;

    return queryRunner.query(`
      INSERT INTO "social_ad_metrics_daily"
        ("tenant_id", "workspace_id", "connection_id", "provider", "source",
         "entity_level", "entity_external_id", "metric_date",
         "account_timezone", "currency", "attribution_setting", "spend",
         "impressions", "reach", "clicks", "link_clicks", "leads",
         "conversions", "conversion_value", "video_views", "is_partial",
         "synced_at")
      VALUES (
        '${input.tenantId ?? tenantId}', '${input.workspaceId ?? workspaceId}',
        '${input.connectionId ?? connectionId}', 'meta_ads',
        '${input.source ?? 'paid'}',
        '${input.entityLevel ?? 'account'}',
        'act_probe_${input.entityLevel ?? 'account'}',
        '${input.metricDate}', 'America/Sao_Paulo', 'BRL',
        '${input.attributionSetting ?? 'account_default'}',
        ${input.spend ?? '10.500000'}, ${input.impressions ?? '1000'},
        ${reach === null ? 'NULL' : reach},
        ${input.clicks ?? '20'}, 15, ${input.leads ?? '2'},
        1.000000, 50.000000, 100, ${input.isPartial ?? false},
        '2026-08-31T06:00:00Z'
      )
    `);
  }

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
         'act_main', 'America/Sao_Paulo', 'BRL'),
        ('${otherTenantConnectionId}', '${otherTenantId}', '${workspaceId}',
         'meta_ads', 'act_other_tenant', 'America/Sao_Paulo', 'BRL'),
        ('${otherWorkspaceConnectionId}', '${tenantId}', '${otherWorkspaceId}',
         'meta_ads', 'act_other_ws', 'America/Sao_Paulo', 'BRL'),
        ('${clientConnectionId}', '${tenantId}', '${workspaceId}', 'meta_ads',
         'act_client', 'America/Sao_Paulo', 'BRL'),
        ('${volumeConnectionId}', '${tenantId}', '${workspaceId}', 'meta_ads',
         'act_volume', 'America/Sao_Paulo', 'BRL')
    `);

    // A revoked credential whose ninety days of history are still true.
    await queryRunner.query(`
      INSERT INTO "social_ad_account_connections"
        ("id", "tenant_id", "workspace_id", "provider", "external_account_id",
         "timezone", "currency", "connection_status", "credential_removed_at")
      VALUES
        ('${disconnectedId}', '${tenantId}', '${workspaceId}', 'meta_ads',
         'act_gone', 'America/Sao_Paulo', 'BRL', 'disconnected', now())
    `);

    await queryRunner.query(`
      UPDATE "social_ad_account_connections"
         SET "agency_client_id" = '${agencyClientId}'
       WHERE "id" = '${clientConnectionId}'
    `);

    reads = new SocialAnalyticsReadService(
      queryRunner.manager.getRepository(SocialAdAccountConnectionEntity),
      queryRunner.manager.getRepository(SocialAdMetricDailyEntity),
      queryRunner.manager.getRepository(SocialAdEntity),
      queryRunner.manager.getRepository(SocialAdSyncRunEntity),
      new SocialAdSyncConfigService(),
    );

    adapter = new SocialPaidMediaIntelligenceAdapter(reads);
  });

  afterAll(async () => {
    if (queryRunner?.isTransactionActive)
      await queryRunner.rollbackTransaction();
    await queryRunner?.release();
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  describe('account facts', () => {
    beforeAll(async () => {
      await insertFact({ metricDate: '2026-08-21', spend: '10.500000' });
      await insertFact({ metricDate: '2026-08-22', spend: '20.250000' });
      await insertFact({ metricDate: '2026-08-23', spend: '5.125000' });
    });

    it('sums account-level spend exactly, in decimal', async () => {
      expect(valueOf(await fetch(), 'spend')).toBe('35.875000');
    });

    it('emits one fact per declared metric', async () => {
      const set = await fetch();

      expect(set.facts).toHaveLength(9);
      expect(set.subject).toEqual({ type: 'ad_account', id: connectionId });
      expect(set.currency).toBe('BRL');
    });

    it('reports day grain per calendar day', async () => {
      const set = await fetch({
        grain: 'day',
        since: '2026-08-21',
        until: '2026-08-23',
      });

      expect(valueOf(set, 'spend', '2026-08-21')).toBe('10.500000');
      expect(valueOf(set, 'spend', '2026-08-22')).toBe('20.250000');
      expect(valueOf(set, 'spend', '2026-08-23')).toBe('5.125000');
    });

    it('day facts sum to the period fact', async () => {
      const [day, period] = await Promise.all([
        fetch({ grain: 'day', since: '2026-08-21', until: '2026-08-23' }),
        fetch({ grain: 'period', since: '2026-08-21', until: '2026-08-23' }),
      ]);

      const summed = day.facts
        .filter((fact) => fact.metricKey === 'impressions')
        .reduce((total, fact) => total + BigInt(fact.value ?? '0'), 0n);

      expect(summed.toString()).toBe(valueOf(period, 'impressions'));
    });

    it('distinguishes a day with no delivery from a day never synced', async () => {
      const set = await fetch({
        grain: 'day',
        since: '2026-08-21',
        until: '2026-08-25',
      });

      expect(valueOf(set, 'spend', '2026-08-23')).toBe('5.125000');
      // 24th and 25th were never observed: null, not zero.
      expect(valueOf(set, 'spend', '2026-08-24')).toBeNull();
      expect(valueOf(set, 'spend', '2026-08-25')).toBeNull();
    });
  });

  /**
   * The single most likely way this port could report a wrong number.
   */
  describe('no double counting', () => {
    it('ignores campaign-level rows when aggregating the account', async () => {
      const before = valueOf(await fetch(), 'spend');

      await insertFact({
        metricDate: '2026-08-21',
        entityLevel: 'campaign',
        spend: '999.000000',
      });

      expect(valueOf(await fetch(), 'spend')).toBe(before);
    });

    it('ignores a second attribution window measuring the same delivery', async () => {
      const before = valueOf(await fetch(), 'spend');

      await insertFact({
        metricDate: '2026-08-22',
        attributionSetting: '7d_click',
        spend: '888.000000',
      });

      expect(valueOf(await fetch(), 'spend')).toBe(before);
      expect((await fetch()).provenance.attributionBasis).toBe(
        'account_default',
      );
    });

    it('ignores non-paid source rows', async () => {
      const before = valueOf(await fetch(), 'spend');

      await insertFact({
        metricDate: '2026-08-23',
        source: 'organic',
        spend: '777.000000',
      });

      expect(valueOf(await fetch(), 'spend')).toBe(before);
    });
  });

  describe('reach', () => {
    it('reports the stored figure for a single day, which is its grain', async () => {
      const set = await fetch({
        grain: 'day',
        since: '2026-08-21',
        until: '2026-08-21',
      });

      expect(valueOf(set, 'reach', '2026-08-21')).toBe('300');
    });

    it('never sums reach across a period', async () => {
      const set = await fetch({ since: '2026-08-21', until: '2026-08-23' });

      // Three days of 300 would sum to 900. The honest answer is that no
      // period-level measurement exists.
      expect(valueOf(set, 'reach')).toBeNull();
    });

    it('declares reach non-additive so a consumer cannot sum the daily values', async () => {
      const set = await fetch({
        grain: 'day',
        since: '2026-08-21',
        until: '2026-08-23',
      });
      const reach = set.descriptors.find((d) => d.key === 'reach')!;

      expect(reach.additivity).toBe('non_additive');
      expect(() => assertAggregable(reach, 3)).toThrow('non_additive');
    });
  });

  describe('partial data', () => {
    it('flags a partial day inside the window and names the final day', async () => {
      await insertFact({
        connectionId: volumeConnectionId,
        metricDate: '2026-08-30',
        isPartial: false,
      });
      await insertFact({
        connectionId: volumeConnectionId,
        metricDate: '2026-08-31',
        isPartial: true,
      });

      const set = await fetch({ subjectId: volumeConnectionId });

      expect(set.freshness.isPartial).toBe(true);
      expect(set.freshness.mode).toBe('synced');
      expect(set.freshness.asOf).toBe('2026-08-31T06:00:00.000Z');
    });

    it('derives coverage from sync progress rather than rows present', async () => {
      const set = await fetch({
        subjectId: volumeConnectionId,
        since: '2026-08-01',
        until: '2026-08-31',
      });

      // Two rows exist, but the sync reached 2026-08-31 — so all 31 days are
      // accounted for, including the ones with no delivery.
      expect(set.freshness.coverage).toEqual({
        expectedDays: 31,
        coveredDays: 31,
        basis: 'sync_progress',
      });
    });
  });

  describe('scope isolation', () => {
    beforeAll(async () => {
      await insertFact({
        connectionId: otherTenantConnectionId,
        tenantId: otherTenantId,
        metricDate: '2026-08-21',
        spend: '500.000000',
      });
      await insertFact({
        connectionId: otherWorkspaceConnectionId,
        workspaceId: otherWorkspaceId,
        metricDate: '2026-08-21',
        spend: '400.000000',
      });
      await insertFact({
        connectionId: clientConnectionId,
        metricDate: '2026-08-21',
        spend: '300.000000',
      });
    });

    it('refuses another tenant’s connection as not found', async () => {
      await expect(
        fetch({ subjectId: otherTenantConnectionId }),
      ).rejects.toThrow('Connection not found');
    });

    it('refuses another workspace’s connection as not found', async () => {
      await expect(
        fetch({ subjectId: otherWorkspaceConnectionId }),
      ).rejects.toThrow('Connection not found');
    });

    /**
     * Agency context must mean `agency_client_id IS NULL`, not "no filter" — the
     * TypeORM trap where a literal null silently widens the lookup.
     */
    it('does not reach a managed client’s connection from agency context', async () => {
      await expect(fetch({ subjectId: clientConnectionId })).rejects.toThrow(
        'Connection not found',
      );
    });

    it('reads the managed client’s connection under its own scope', async () => {
      const set = await fetch({
        subjectId: clientConnectionId,
        client: agencyClientId,
        since: '2026-08-21',
        until: '2026-08-21',
      });

      expect(valueOf(set, 'spend')).toBe('300.000000');
    });

    it('does not reach the agency’s connection from client context', async () => {
      await expect(
        fetch({ subjectId: connectionId, client: agencyClientId }),
      ).rejects.toThrow('Connection not found');
    });
  });

  /**
   * A disconnected account's stored history is still true and still the
   * client's. The read path refuses to filter on connection status, and the
   * adapter must not reintroduce that filter.
   */
  it('keeps a disconnected connection’s history readable', async () => {
    await insertFact({
      connectionId: disconnectedId,
      metricDate: '2026-08-21',
      spend: '42.000000',
    });

    const set = await fetch({
      subjectId: disconnectedId,
      since: '2026-08-21',
      until: '2026-08-21',
    });

    expect(valueOf(set, 'spend')).toBe('42.000000');
  });

  describe('contract', () => {
    it('carries provider, source and attribution as dimensions', async () => {
      const set = await fetch();

      expect(set.facts[0].dimensions).toEqual({
        provider: 'meta',
        source: 'paid',
        attribution: 'account_default',
      });
    });

    it('names the read model as the canonical source', async () => {
      const set = await fetch();

      expect(set.provenance.canonicalSource).toBe('social_ad_metrics_daily');
      expect(set.provenance.ingestionMode).toBe('synced');
      expect(JSON.stringify(set.provenance)).not.toContain('syncRunIds');
    });

    it('emits no ratio as a fact', async () => {
      const set = await fetch();
      const keys = new Set(set.facts.map((fact) => fact.metricKey));

      for (const ratio of adapter.ratios) {
        expect(keys.has(ratio.key)).toBe(false);
      }
    });

    it('reports businessMode null so Social works without LeadFlow', async () => {
      expect((await fetch()).businessMode).toBeNull();
    });
  });

  /**
   * The trust test.
   *
   * The dashboard and the fact port must not be able to disagree: they read the
   * same rows, and any divergence would mean one of them is applying a different
   * filter. Asserting equality here is what makes the delegation in the adapter
   * a checked property rather than an intention stated in a comment.
   */
  describe('cross-check against the shipped Analytics API', () => {
    it('reports the same totals the overview endpoint reports', async () => {
      const [set, overview] = await Promise.all([
        fetch({ since: '2026-08-21', until: '2026-08-23' }),
        reads.overview({
          tenantId,
          workspaceId,
          agencyClientId: null,
          connectionId,
          since: '2026-08-21',
          until: '2026-08-23',
        }),
      ]);

      expect(valueOf(set, 'spend')).toBe(overview.current.spend);
      expect(valueOf(set, 'impressions')).toBe(overview.current.impressions);
      expect(valueOf(set, 'clicks')).toBe(overview.current.clicks);
      expect(valueOf(set, 'link_clicks')).toBe(overview.current.linkClicks);
      expect(valueOf(set, 'leads')).toBe(overview.current.leads);
      expect(valueOf(set, 'conversions')).toBe(overview.current.conversions);
      expect(valueOf(set, 'conversion_value')).toBe(
        overview.current.conversionValue,
      );
      expect(valueOf(set, 'video_views')).toBe(overview.current.videoViews);
      expect(valueOf(set, 'reach')).toBe(overview.current.reach);
    });

    it('reports the same per-day values the timeseries endpoint reports', async () => {
      const [set, series] = await Promise.all([
        fetch({ grain: 'day', since: '2026-08-21', until: '2026-08-23' }),
        reads.timeseries({
          tenantId,
          workspaceId,
          agencyClientId: null,
          connectionId,
          since: '2026-08-21',
          until: '2026-08-23',
        }),
      ]);

      for (const point of series.points) {
        expect(valueOf(set, 'spend', point.date)).toBe(point.spend);
        expect(valueOf(set, 'reach', point.date)).toBe(point.reach);
      }
    });

    /**
     * Ratios are declared, not emitted — but applying the declaration to the
     * facts must reproduce the KPI the dashboard shows, or the recipe is wrong.
     */
    it('yields the dashboard’s CTR when its recipe is applied to the facts', async () => {
      const [set, overview] = await Promise.all([
        fetch({ since: '2026-08-21', until: '2026-08-23' }),
        reads.overview({
          tenantId,
          workspaceId,
          agencyClientId: null,
          connectionId,
          since: '2026-08-21',
          until: '2026-08-23',
        }),
      ]);

      const ctr = adapter.ratios.find((ratio) => ratio.key === 'ctr')!;
      const numerator = BigInt(valueOf(set, ctr.numerator)!);
      const denominator = BigInt(valueOf(set, ctr.denominator)!);

      const derived =
        (numerator * BigInt(ctr.numeratorBasis!) * 1_000_000n) / denominator;

      expect(Number(derived) / 1_000_000).toBeCloseTo(
        Number(overview.current.ctr),
        6,
      );
    });
  });

  /**
   * Realistic windows, measured rather than assumed.
   *
   * The point is not a threshold to enforce — it is to know the cost before
   * anyone proposes materialising anything. Nothing is materialised here.
   */
  describe('performance', () => {
    beforeAll(async () => {
      // 120 consecutive days on one connection, so both windows are covered.
      const values: string[] = [];
      for (let offset = 0; offset < 120; offset += 1) {
        const date = new Date(Date.UTC(2026, 3, 1) + offset * 86_400_000)
          .toISOString()
          .slice(0, 10);
        values.push(`(
          '${tenantId}', '${workspaceId}', '${volumeConnectionId}', 'meta_ads',
          'paid', 'account', 'act_volume_day', '${date}', 'America/Sao_Paulo',
          'BRL', 'account_default', 12.345678, 1000, 300, 20, 15, 2,
          1.000000, 50.000000, 100, false, '2026-08-31T06:00:00Z'
        )`);
      }

      await queryRunner.query(`
        INSERT INTO "social_ad_metrics_daily"
          ("tenant_id", "workspace_id", "connection_id", "provider", "source",
           "entity_level", "entity_external_id", "metric_date",
           "account_timezone", "currency", "attribution_setting", "spend",
           "impressions", "reach", "clicks", "link_clicks", "leads",
           "conversions", "conversion_value", "video_views", "is_partial",
           "synced_at")
        VALUES ${values.join(',')}
      `);
    });

    it.each([
      ['30d', '2026-06-02', '2026-07-01'],
      ['90d', '2026-04-03', '2026-07-01'],
    ])('answers a %s period window', async (label, since, until) => {
      const started = Date.now();
      const set = await fetch({ subjectId: volumeConnectionId, since, until });
      const elapsed = Date.now() - started;

      expect(set.facts).toHaveLength(9);
      expect(valueOf(set, 'spend')).not.toBeNull();

      // Reported rather than asserted tightly: the number is the deliverable,
      // and a tight bound would make this suite fail on a loaded machine.

      console.log(`[perf] paid_media period ${label}: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(5_000);
    });

    it.each([
      ['30d', '2026-06-02', '2026-07-01', 30],
      ['90d', '2026-04-03', '2026-07-01', 90],
    ])('answers a %s day-grain window', async (label, since, until, days) => {
      const started = Date.now();
      const set = await fetch({
        subjectId: volumeConnectionId,
        grain: 'day',
        since,
        until,
      });
      const elapsed = Date.now() - started;

      expect(set.facts).toHaveLength(days * 9);

      console.log(`[perf] paid_media day ${label}: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(5_000);
    });
  });
});
