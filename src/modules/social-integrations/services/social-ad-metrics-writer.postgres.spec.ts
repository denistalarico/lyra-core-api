import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { SocialAdMetricDailyEntity } from '../entities/social-ad-metric-daily.entity';
import { META_ACTION_MAPPING_VERSION } from '../sync/meta-action-mapping';
import type { NormalizedAdMetricDaily } from '../sync/meta-ads-insights.contract';
import { SocialAdMetricsWriterService } from './social-ad-metrics-writer.service';
import { describePostgresIntegration } from '../../../testing/postgres-integration';

/**
 * The metrics writer against a real PostgreSQL, inside one rolled-back
 * transaction.
 *
 * Idempotence lives in an `ON CONFLICT` clause and `created_at` preservation in
 * what that clause omits. Neither is observable through a mock — a spec built
 * on one would prove the strings were passed along, not that Postgres matched
 * the unique index or that the restated numbers actually replaced the old ones.
 *
 * Gated behind the same flag as the other PostgreSQL specs.
 */
const run = describePostgresIntegration();

run('SocialAdMetricsWriterService against PostgreSQL', () => {
  let queryRunner: QueryRunner;
  let writer: SocialAdMetricsWriterService;

  const connectionId = randomUUID();
  const tenantId = randomUUID();
  const workspaceId = randomUUID();

  function fact(
    overrides: Partial<NormalizedAdMetricDaily> = {},
  ): NormalizedAdMetricDaily {
    return {
      tenantId,
      workspaceId,
      agencyClientId: null,
      connectionId,
      provider: 'meta_ads',
      source: 'paid',
      entityLevel: 'account',
      entityExternalId: 'act_dry_run',
      campaignExternalId: null,
      metricDate: '2026-07-10',
      accountTimezone: 'America/Sao_Paulo',
      currency: 'BRL',
      attributionSetting: 'account_default',
      spend: '11.510000',
      impressions: '412',
      reach: '380',
      clicks: '5',
      linkClicks: '3',
      leads: '2',
      conversions: '2.000000',
      conversionValue: '0.000000',
      videoViews: '72',
      actions: {
        mappingVersion: META_ACTION_MAPPING_VERSION,
        counts: { lead: '2.000000' },
        values: {},
      },
      isPartial: false,
      syncedAt: new Date('2026-08-26T10:00:00Z'),
      ...overrides,
    };
  }

  const factsOf = (metricDate: string, level = 'account') =>
    queryRunner.query(
      `SELECT "spend", "impressions", "reach", "leads", "conversions",
              "conversion_value", "video_views", "actions", "metric_date",
              "account_timezone", "currency", "is_partial",
              "entity_external_id", "campaign_external_id",
              "created_at", "synced_at", "raw", "sync_run_id"
       FROM "social_ad_metrics_daily"
       WHERE "connection_id" = '${connectionId}'
         AND "entity_level" = '${level}'
         AND "metric_date" = '${metricDate}'`,
    ) as Promise<
      {
        spend: string;
        impressions: string;
        reach: string | null;
        leads: string;
        conversions: string;
        conversion_value: string;
        video_views: string;
        actions: Record<string, unknown>;
        metric_date: string | Date;
        account_timezone: string;
        currency: string;
        is_partial: boolean;
        entity_external_id: string;
        campaign_external_id: string | null;
        created_at: Date;
        synced_at: Date;
        raw: unknown;
        sync_run_id: string | null;
      }[]
    >;

  const countRows = async () => {
    const rows = (await queryRunner.query(
      `SELECT count(*)::int AS count FROM "social_ad_metrics_daily"
       WHERE "connection_id" = '${connectionId}'`,
    )) as { count: number }[];

    return rows[0].count;
  };

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    queryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    await queryRunner.query(`
      INSERT INTO "social_ad_account_connections"
        ("id", "tenant_id", "workspace_id", "provider", "external_account_id")
      VALUES ('${connectionId}', '${tenantId}', '${workspaceId}', 'meta_ads', 'act_dry_run')
    `);

    writer = new SocialAdMetricsWriterService(
      queryRunner.manager.getRepository(SocialAdMetricDailyEntity),
    );
  });

  afterAll(async () => {
    if (queryRunner?.isTransactionActive)
      await queryRunner.rollbackTransaction();
    await queryRunner?.release();
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('writes a day the first time it sees it', async () => {
    const written = await writer.upsert([
      fact(),
      fact({ metricDate: '2026-07-11', spend: '6.200000' }),
    ]);

    expect(written).toBe(2);
    expect(await countRows()).toBe(2);
  });

  it('stores money and counts exactly as given', async () => {
    const [row] = await factsOf('2026-07-10');

    expect(row.spend).toBe('11.510000');
    expect(row.impressions).toBe('412');
    expect(row.reach).toBe('380');
    expect(row.leads).toBe('2');
    expect(row.video_views).toBe('72');
    expect(row.currency).toBe('BRL');
    expect(row.account_timezone).toBe('America/Sao_Paulo');
    expect(row.is_partial).toBe(false);
  });

  it('stores the calendar day without shifting it', async () => {
    const [row] = await factsOf('2026-07-10');

    const stored =
      row.metric_date instanceof Date
        ? row.metric_date.toISOString().slice(0, 10)
        : String(row.metric_date);

    // A `date` column and a `YYYY-MM-DD` string: no instant, so no timezone to
    // apply twice.
    expect(stored).toBe('2026-07-10');
  });

  it('keeps both action maps and the mapping version, so facts can be re-derived', async () => {
    const [row] = await factsOf('2026-07-10');

    // The version survives the jsonb round trip as a number, which is what a
    // future re-derivation will filter on.
    expect(row.actions).toEqual({
      mappingVersion: META_ACTION_MAPPING_VERSION,
      counts: { lead: '2.000000' },
      values: {},
    });
  });

  it('leaves raw and sync_run_id untouched in this slice', async () => {
    const [row] = await factsOf('2026-07-10');

    expect(row.raw).toBeNull();
    expect(row.sync_run_id).toBeNull();
  });

  it('re-runs the same window without duplicating a row', async () => {
    await writer.upsert([
      fact(),
      fact({ metricDate: '2026-07-11', spend: '6.200000' }),
    ]);

    // Meta restates recent days, so a re-read must collide and update.
    expect(await countRows()).toBe(2);
  });

  it('applies a restatement and keeps created_at', async () => {
    const [before] = await factsOf('2026-07-10');

    await writer.upsert([
      fact({
        spend: '12.000000',
        leads: '3',
        conversions: '3.000000',
        conversionValue: '150.000000',
        syncedAt: new Date('2026-08-26T18:00:00Z'),
      }),
    ]);

    const [after] = await factsOf('2026-07-10');

    // A conversion attributed today belongs to a click three days ago: the
    // numbers change, the record of when Lyra first saw the day does not.
    expect(after.spend).toBe('12.000000');
    expect(after.leads).toBe('3');
    expect(after.conversion_value).toBe('150.000000');
    expect(after.created_at).toEqual(before.created_at);
    expect(after.synced_at.toISOString()).toBe('2026-08-26T18:00:00.000Z');
  });

  it('treats another attribution setting as a separate fact, not an overwrite', async () => {
    await writer.upsert([
      fact({
        attributionSetting: '7d_click' as never,
        spend: '11.510000',
        leads: '5',
      }),
    ]);

    // Same object, same day, measured differently. Overwriting would replace a
    // number already reported to a client.
    expect(await countRows()).toBe(3);
    expect(await factsOf('2026-07-10')).toHaveLength(2);
  });

  it('treats another source as a separate fact too', async () => {
    await writer.upsert([
      fact({ source: 'organic' as never, spend: '0.000000' }),
    ]);

    expect(await countRows()).toBe(4);
  });

  it('keeps account and campaign facts for the same day apart', async () => {
    await writer.upsert([
      fact({
        entityLevel: 'campaign',
        entityExternalId: '120244382299410411',
        campaignExternalId: '120244382299410411',
      }),
    ]);

    expect(await factsOf('2026-07-10', 'campaign')).toHaveLength(1);
    expect(await countRows()).toBe(5);
  });

  it('accepts a null reach, since reach is not additive', async () => {
    await writer.upsert([fact({ metricDate: '2026-07-12', reach: null })]);

    const [row] = await factsOf('2026-07-12');

    expect(row.reach).toBeNull();
  });

  /**
   * §6 and §8 — ad set as a legitimate value of `entity_level`.
   *
   * These are the assertions the schema audit could only argue for: the CHECK
   * constraint lists `adset`, the column is a `varchar`, and `entity_level` is
   * the fifth column of `UQ_social_ad_metrics_daily_fact`. Whether all three
   * hold together is a question for Postgres, not for a reviewer, which is why
   * it is asked here rather than in a unit test — and why I3.4 needed no
   * migration.
   */
  describe('ad set facts', () => {
    const adsetFact = (overrides: Partial<NormalizedAdMetricDaily> = {}) =>
      fact({
        entityLevel: 'adset',
        entityExternalId: '120244382526760411',
        campaignExternalId: '120244382299410411',
        metricDate: '2026-07-20',
        ...overrides,
      });

    it('accepts adset as an entity level, with no migration', async () => {
      // The CHECK constraint has listed all four levels since S2.2. If it did
      // not, this insert would fail with a constraint violation rather than a
      // type error, which is exactly the failure a schema audit can miss.
      const written = await writer.upsert([adsetFact()]);

      expect(written).toBe(1);
      expect(await factsOf('2026-07-20', 'adset')).toHaveLength(1);
    });

    it('stores the ad set as the identity and the campaign as the parent', async () => {
      const [row] = await factsOf('2026-07-20', 'adset');

      expect(row.entity_external_id).toBe('120244382526760411');
      expect(row.campaign_external_id).toBe('120244382299410411');
    });

    it('keeps two ad sets of one campaign as two rows for the same day', async () => {
      await writer.upsert([
        adsetFact({ entityExternalId: '120244382526760412' }),
      ]);

      const rows = await factsOf('2026-07-20', 'adset');

      expect(rows).toHaveLength(2);
      // Same parent on both: a campaign roll-up still finds them.
      expect(new Set(rows.map((row) => row.campaign_external_id))).toEqual(
        new Set(['120244382299410411']),
      );
    });

    it('re-runs an ad set window without duplicating a row', async () => {
      const before = await countRows();

      // Two separate upserts, as two runs of the same window would be. One
      // batch holding the same fact twice is a different question — Postgres
      // rejects it outright ("cannot affect row a second time") — and the
      // reader cannot produce it, because Meta returns one row per object
      // per day.
      await writer.upsert([adsetFact()]);
      await writer.upsert([adsetFact()]);

      expect(await countRows()).toBe(before);
    });

    it('restates an ad set day in place, as Meta restates it', async () => {
      await writer.upsert([adsetFact({ spend: '99.990000', leads: '7' })]);

      const [row] = (await factsOf('2026-07-20', 'adset')).filter(
        (candidate) => candidate.entity_external_id === '120244382526760411',
      );

      expect(row.spend).toBe('99.990000');
      expect(row.leads).toBe('7');
    });

    it('does not collide with a campaign that happens to share the id', async () => {
      // §8, stated as a stored fact rather than as a reading of the index
      // definition. Meta ids are unique per object *type*, not across types, so
      // a unique key without `entity_level` would let an ad set silently
      // overwrite a campaign's day — one number replacing another that means
      // something else entirely.
      const sharedId = '120244000000000999';

      await writer.upsert([
        fact({
          entityLevel: 'campaign',
          entityExternalId: sharedId,
          campaignExternalId: sharedId,
          metricDate: '2026-07-21',
          spend: '10.000000',
        }),
        fact({
          entityLevel: 'adset',
          entityExternalId: sharedId,
          campaignExternalId: '120244382299410411',
          metricDate: '2026-07-21',
          spend: '20.000000',
        }),
      ]);

      const campaignRows = (await factsOf('2026-07-21', 'campaign')).filter(
        (row) => row.entity_external_id === sharedId,
      );
      const adsetRows = (await factsOf('2026-07-21', 'adset')).filter(
        (row) => row.entity_external_id === sharedId,
      );

      expect(campaignRows).toHaveLength(1);
      expect(adsetRows).toHaveLength(1);
      expect(campaignRows[0].spend).toBe('10.000000');
      expect(adsetRows[0].spend).toBe('20.000000');
    });

    it('accepts a null reach on an ad set row too', async () => {
      // Reach is non-additive at every grain, and ad set is the level most
      // likely to be summed into a per-destination total.
      await writer.upsert([
        adsetFact({ metricDate: '2026-07-22', reach: null }),
      ]);

      const [row] = await factsOf('2026-07-22', 'adset');

      expect(row.reach).toBeNull();
    });

    it('stores no ratio column for an ad set fact either', async () => {
      // §9: facts, never quotients. The columns simply do not exist, which is
      // the only way to guarantee nobody sums two of them.
      const columns = (await queryRunner.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name = 'social_ad_metrics_daily'`,
      )) as { column_name: string }[];

      const names = columns.map((column) => column.column_name);

      for (const ratio of [
        'ctr',
        'cpc',
        'cpm',
        'cpl',
        'cpa',
        'roas',
        'frequency',
      ]) {
        expect(names).not.toContain(ratio);
      }
    });
  });
});
