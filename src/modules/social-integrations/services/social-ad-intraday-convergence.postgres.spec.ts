import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { SocialAdMetricDailyEntity } from '../entities/social-ad-metric-daily.entity';
import { META_ACTION_MAPPING_VERSION } from '../sync/meta-action-mapping';
import type { NormalizedAdMetricDaily } from '../sync/meta-ads-insights.contract';
import { SocialAdMetricsWriterService } from './social-ad-metrics-writer.service';
import { describePostgresIntegration } from '../../../testing/postgres-integration';

/**
 * A day converging from provisional to final, against a real PostgreSQL.
 *
 * This is the property S2.6 rests on, and it cannot be observed anywhere but
 * here: whether the 12:00 snapshot, the 18:00 snapshot and tomorrow's daily run
 * are one row or three is decided by whether Postgres matches
 * `UQ_social_ad_metrics_daily_fact`, which is a statement about an index rather
 * than about our code. If it did not match, nothing would fail — the inserts
 * would all succeed — and one day's spend would appear three times in every
 * total that summed it.
 *
 * `is_partial` is deliberately not part of that key. It describes *how* the day
 * was read, not *which* day was read, and putting it in the key would produce
 * exactly the duplicate this file exists to rule out.
 *
 * Gated behind the same guard as every other PostgreSQL spec, and it runs
 * inside one transaction that is rolled back: the specs must never touch a
 * database that is not disposable.
 */
const run = describePostgresIntegration();

run('Intraday convergence against PostgreSQL', () => {
  let queryRunner: QueryRunner;
  let writer: SocialAdMetricsWriterService;

  const connectionId = randomUUID();
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const otherConnectionId = randomUUID();

  /** The account's own current day, as an intraday run would name it. */
  const TODAY = '2026-08-27';

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
      metricDate: TODAY,
      accountTimezone: 'America/Sao_Paulo',
      currency: 'BRL',
      attributionSetting: 'account_default',
      spend: '30.000000',
      impressions: '400',
      reach: '300',
      clicks: '10',
      linkClicks: '6',
      leads: '1',
      conversions: '1.000000',
      conversionValue: '0.000000',
      videoViews: '20',
      actions: {
        mappingVersion: META_ACTION_MAPPING_VERSION,
        counts: { lead: '1.000000' },
        values: {},
      },
      isPartial: true,
      syncedAt: new Date('2026-08-27T15:00:00Z'),
      ...overrides,
    };
  }

  const dayRows = () =>
    queryRunner.query(
      `SELECT "spend", "leads", "is_partial", "created_at", "synced_at"
         FROM "social_ad_metrics_daily"
        WHERE "connection_id" = '${connectionId}'
          AND "metric_date" = '${TODAY}'`,
    ) as Promise<
      {
        spend: string;
        leads: string;
        is_partial: boolean;
        created_at: Date;
        synced_at: Date;
      }[]
    >;

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    queryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    for (const id of [connectionId, otherConnectionId]) {
      await queryRunner.query(`
        INSERT INTO "social_ad_account_connections"
          ("id", "tenant_id", "workspace_id", "provider", "external_account_id")
        VALUES ('${id}', '${tenantId}', '${workspaceId}', 'meta_ads', 'act_dry_run_${id.slice(0, 8)}')
      `);
    }

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

  it('writes the first snapshot of an unfinished day as provisional', async () => {
    await writer.upsert([fact()]);

    const rows = await dayRows();

    expect(rows).toHaveLength(1);
    expect(rows[0].spend).toBe('30.000000');
    expect(rows[0].is_partial).toBe(true);
  });

  it('moves the same row when the next snapshot arrives', async () => {
    await writer.upsert([
      fact({
        spend: '55.000000',
        leads: '2',
        syncedAt: new Date('2026-08-27T21:00:00Z'),
      }),
    ]);

    const rows = await dayRows();

    // One row, not two. Three snapshots of one day stored side by side would
    // triple that day's spend in every report that summed it.
    expect(rows).toHaveLength(1);
    expect(rows[0].spend).toBe('55.000000');
    expect(rows[0].leads).toBe('2');
    expect(rows[0].is_partial).toBe(true);
    // The freshness stamp moves; it is the only record of when this
    // restatement was collected.
    expect(rows[0].synced_at.toISOString()).toBe('2026-08-27T21:00:00.000Z');
  });

  it('closes the day in place when the daily run reads it as settled', async () => {
    const [before] = await dayRows();

    await writer.upsert([
      fact({
        spend: '81.000000',
        leads: '3',
        isPartial: false,
        syncedAt: new Date('2026-08-28T07:00:00Z'),
      }),
    ]);

    const rows = await dayRows();

    expect(rows).toHaveLength(1);
    expect(rows[0].spend).toBe('81.000000');
    // The flag flips on the row that was already there. A separate final row
    // would leave the provisional one behind to be summed alongside it.
    expect(rows[0].is_partial).toBe(false);
    // `created_at` is not in the refreshed column list: it answers "when did
    // Lyra first record this day", and a re-read must not reset that.
    expect(rows[0].created_at.toISOString()).toBe(
      before.created_at.toISOString(),
    );
  });

  it('does not reopen a settled day if an intraday run arrives late', async () => {
    // Not a policy in the writer — it faithfully writes what it is handed. The
    // protection is upstream: `assertIntradayInsightsWindow` refuses a run whose
    // day has turned over, so no such write is ever produced. This records the
    // consequence if that guard were ever removed.
    await writer.upsert([fact({ spend: '81.000000', isPartial: true })]);

    const rows = await dayRows();

    expect(rows).toHaveLength(1);
    expect(rows[0].is_partial).toBe(true);

    // Put it back, so the table is left settled for anything reading after.
    await writer.upsert([fact({ spend: '81.000000', isPartial: false })]);
  });
});
