import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { SocialAdAccountConnectionEntity } from '../entities/social-ad-account-connection.entity';
import { SocialAdBreakdownDailyEntity } from '../entities/social-ad-breakdown-daily.entity';
import type { NormalizedAdBreakdownDaily } from '../sync/meta-ads-breakdown.contract';
import { SocialAdBreakdownReadService } from './social-ad-breakdown.read.service';
import { SocialAdBreakdownWriterService } from './social-ad-breakdown-writer.service';

/**
 * The breakdown ingest and read against a real PostgreSQL.
 *
 * Every claim this slice makes is a database guarantee and cannot be checked
 * against a mock. Whether a re-read of a window updates in place rather than
 * doubling the numbers depends on a unique index; whether one dimension's
 * buckets can collide with another's depends on that index including
 * `breakdown_kind`; whether a `numeric(18,6)` sums without drifting in the cents
 * depends on Postgres doing the addition. A fixture-driven unit test would pass
 * under every one of those being wrong.
 *
 * All of it runs inside one transaction that is rolled back, on
 * `lyra_agency_test` behind the official guard.
 */
const run = describePostgresIntegration();

run('Social ad breakdowns against PostgreSQL', () => {
  let queryRunner: QueryRunner;
  let writer: SocialAdBreakdownWriterService;
  let reader: SocialAdBreakdownReadService;

  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const connectionId = randomUUID();
  const otherConnectionId = randomUUID();

  const SYNCED_AT = new Date('2026-09-20T12:00:00.000Z');

  /**
   * Every statement goes through the suite's own `QueryRunner`, never through
   * `AgencyDataSource.query`.
   *
   * The DataSource hands each call an arbitrary connection from the pool, so a
   * bare `query('BEGIN')` opens a transaction on one connection while the
   * repositories write on others. The transaction then wraps nothing: the
   * `ROLLBACK` in `afterAll` rolled back an empty one and the rows this suite
   * wrote stayed committed in `lyra_agency_test` (twelve leftover connection
   * rows were still there when this was found). A `QueryRunner` pins one
   * connection, and `queryRunner.manager.getRepository` puts the services on it
   * too, which is what makes the rollback real.
   */
  const query = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    queryRunner.query(sql, params) as Promise<T[]>;

  const fact = (
    overrides: Partial<NormalizedAdBreakdownDaily> = {},
  ): NormalizedAdBreakdownDaily => ({
    tenantId,
    workspaceId,
    agencyClientId: null,
    connectionId,
    provider: 'meta_ads',
    entityLevel: 'account',
    entityExternalId: 'act_1',
    metricDate: '2026-09-01',
    accountTimezone: 'America/Sao_Paulo',
    currency: 'BRL',
    breakdownKind: 'age_gender',
    breakdownKey: '25-34|female',
    spend: '10.000000',
    impressions: '100',
    clicks: '10',
    linkClicks: '5',
    reach: '80',
    actions: { mappingVersion: 1, counts: {}, values: {} },
    isPartial: false,
    syncedAt: SYNCED_AT,
    ...overrides,
  });

  const read = (
    kind: NormalizedAdBreakdownDaily['breakdownKind'] = 'age_gender',
    since = '2026-09-01',
    until = '2026-09-30',
  ) =>
    reader.breakdown({
      tenantId,
      workspaceId,
      agencyClientId: null,
      connectionId,
      kind,
      since,
      until,
    });

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    queryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    for (const [id, tenant, workspace] of [
      [connectionId, tenantId, workspaceId],
      [otherConnectionId, otherTenantId, otherWorkspaceId],
    ]) {
      await query(
        `INSERT INTO "social_ad_account_connections"
           ("id", "tenant_id", "workspace_id", "provider", "external_account_id", "timezone")
         VALUES ($1, $2, $3, 'meta_ads', $4, 'America/Sao_Paulo')`,
        [id, tenant, workspace, `act_${randomUUID()}`],
      );
    }

    writer = new SocialAdBreakdownWriterService(
      queryRunner.manager.getRepository(SocialAdBreakdownDailyEntity),
    );
    reader = new SocialAdBreakdownReadService(
      queryRunner.manager.getRepository(SocialAdAccountConnectionEntity),
      queryRunner.manager.getRepository(SocialAdBreakdownDailyEntity),
    );
  });

  afterAll(async () => {
    if (queryRunner?.isTransactionActive)
      await queryRunner.rollbackTransaction();
    await queryRunner?.release();
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  describe('idempotency', () => {
    /**
     * The property the whole ingest rests on.
     *
     * Meta restates recent days for up to 28 days, so re-reading a window must
     * update in place. Two rows for the same bucket would double the spend on
     * every chart that sums them.
     */
    it('updates a bucket in place when the same day is read again', async () => {
      const key = `25-34|female-${randomUUID().slice(0, 8)}`;

      await writer.upsert([fact({ breakdownKey: key, spend: '10.000000' })]);
      await writer.upsert([
        fact({ breakdownKey: key, spend: '14.500000', impressions: '140' }),
      ]);

      const rows = await query<{ spend: string; impressions: string }>(
        `SELECT "spend", "impressions" FROM "social_ad_breakdown_daily"
          WHERE "connection_id" = $1 AND "breakdown_key" = $2`,
        [connectionId, key],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].spend).toBe('14.500000');
      expect(rows[0].impressions).toBe('140');
    });

    /**
     * Why `breakdown_kind` is in the unique key.
     *
     * Meta's dimension vocabularies overlap — a device platform and a publisher
     * platform could name the same value. Keyed on the value alone, one would
     * silently overwrite the other.
     */
    it('keeps the same key under two dimensions as two rows', async () => {
      const key = `shared-${randomUUID().slice(0, 8)}`;

      await writer.upsert([
        fact({
          breakdownKind: 'device_platform',
          breakdownKey: key,
          spend: '3.000000',
        }),
        fact({
          breakdownKind: 'publisher_platform',
          breakdownKey: key,
          spend: '7.000000',
        }),
      ]);

      const rows = await query<{ breakdown_kind: string; spend: string }>(
        `SELECT "breakdown_kind", "spend" FROM "social_ad_breakdown_daily"
          WHERE "connection_id" = $1 AND "breakdown_key" = $2
          ORDER BY "breakdown_kind"`,
        [connectionId, key],
      );

      expect(rows).toEqual([
        { breakdown_kind: 'device_platform', spend: '3.000000' },
        { breakdown_kind: 'publisher_platform', spend: '7.000000' },
      ]);
    });

    it('preserves created_at across a restatement', async () => {
      const key = `created-${randomUUID().slice(0, 8)}`;

      await writer.upsert([fact({ breakdownKey: key })]);

      const [first] = await query<{ created_at: Date }>(
        `SELECT "created_at" FROM "social_ad_breakdown_daily"
          WHERE "connection_id" = $1 AND "breakdown_key" = $2`,
        [connectionId, key],
      );

      await writer.upsert([fact({ breakdownKey: key, spend: '99.000000' })]);

      const [second] = await query<{ created_at: Date }>(
        `SELECT "created_at" FROM "social_ad_breakdown_daily"
          WHERE "connection_id" = $1 AND "breakdown_key" = $2`,
        [connectionId, key],
      );

      // It answers "when did Lyra first record this bucket". A write that
      // overwrote it would reset that answer on every re-read, permanently.
      expect(second.created_at).toEqual(first.created_at);
    });

    it('refuses a negative spend at the database, not only in the parser', async () => {
      /**
       * Inside a savepoint: the suite shares one transaction, and a constraint
       * violation aborts it. Without this the expected failure would poison
       * every test that runs afterwards. Same remedy, for the same reason, as
       * the duplicate-observation case in
       * `social-ad-destination-observations.postgres.spec.ts`.
       */
      await queryRunner.query('SAVEPOINT negative_spend_attempt');

      await expect(
        writer.upsert([
          fact({
            breakdownKey: `negative-${randomUUID().slice(0, 8)}`,
            spend: '-1.000000',
          }),
        ]),
      ).rejects.toThrow();

      await queryRunner.query('ROLLBACK TO SAVEPOINT negative_spend_attempt');
    });
  });

  describe('the read', () => {
    it('sums money and counts across the days of the window', async () => {
      const key = `sum-${randomUUID().slice(0, 8)}`;

      await writer.upsert([
        fact({
          breakdownKey: key,
          metricDate: '2026-09-01',
          spend: '10.120000',
          impressions: '100',
        }),
        fact({
          breakdownKey: key,
          metricDate: '2026-09-02',
          spend: '5.030000',
          impressions: '50',
        }),
      ]);

      const result = await read();
      const bucket = result.buckets.find((item) => item.key === key);

      // Decimal addition in Postgres, not binary floating point in JS: the
      // cents have to survive.
      expect(bucket?.spend).toBe('15.150000');
      expect(bucket?.impressions).toBe('150');
    });

    /**
     * Reach is non-additive in *two* directions here, which is one more than on
     * the unsplit facts table.
     */
    it('never returns a period reach, in either direction', async () => {
      const key = `reach-${randomUUID().slice(0, 8)}`;

      await writer.upsert([
        fact({ breakdownKey: key, metricDate: '2026-09-01', reach: '80' }),
        fact({ breakdownKey: key, metricDate: '2026-09-02', reach: '90' }),
      ]);

      const result = await read();
      const bucket = result.buckets.find((item) => item.key === key);

      // Not 170 (the same people counted twice across days), and not 90 (one
      // day's reach passed off as the period's). Absence is the honest answer.
      expect(bucket?.reach).toBeNull();
    });

    it('returns only the dimension that was asked for', async () => {
      const key = `only-${randomUUID().slice(0, 8)}`;

      await writer.upsert([
        fact({ breakdownKind: 'device_platform', breakdownKey: key }),
      ]);

      const result = await read('publisher_platform');

      expect(result.buckets.some((item) => item.key === key)).toBe(false);
    });

    it('ignores days outside the window', async () => {
      const key = `window-${randomUUID().slice(0, 8)}`;

      await writer.upsert([
        fact({
          breakdownKey: key,
          metricDate: '2026-08-31',
          spend: '9.000000',
        }),
        fact({
          breakdownKey: key,
          metricDate: '2026-09-02',
          spend: '4.000000',
        }),
      ]);

      const result = await read('age_gender', '2026-09-01', '2026-09-30');
      const bucket = result.buckets.find((item) => item.key === key);

      expect(bucket?.spend).toBe('4.000000');
    });

    it('does not read another tenant rows through a leaked connection id', async () => {
      const key = `tenant-${randomUUID().slice(0, 8)}`;

      await writer.upsert([
        fact({
          tenantId: otherTenantId,
          workspaceId: otherWorkspaceId,
          connectionId: otherConnectionId,
          breakdownKey: key,
        }),
      ]);

      const result = await read();

      expect(result.buckets.some((item) => item.key === key)).toBe(false);
    });

    it('answers "not found" for a connection outside the caller scope', async () => {
      await expect(
        reader.breakdown({
          tenantId,
          workspaceId,
          agencyClientId: null,
          connectionId: otherConnectionId,
          kind: 'age_gender',
          since: '2026-09-01',
          until: '2026-09-30',
        }),
      ).rejects.toThrow('Connection not found.');
    });

    /**
     * The difference between "no audience" and "not ingested yet".
     *
     * Ingestion is gated off by default, so an empty distribution is the
     * expected state on most deployments — and a UI that read it as "nobody was
     * reached" would be wrong on all of them.
     */
    it('reports hasData false for a window with no rows', async () => {
      const result = await read('age_gender', '2025-01-01', '2025-01-31');

      expect(result.hasData).toBe(false);
      expect(result.buckets).toEqual([]);
      expect(result.coveredDays).toBe(0);
      expect(result.expectedDays).toBe(31);
    });

    it('counts covered days without multiplying them by the bucket count', async () => {
      const suffix = randomUUID().slice(0, 8);

      await writer.upsert([
        fact({
          breakdownKind: 'device_platform',
          breakdownKey: `mobile-${suffix}`,
          metricDate: '2026-10-01',
        }),
        fact({
          breakdownKind: 'device_platform',
          breakdownKey: `desktop-${suffix}`,
          metricDate: '2026-10-01',
        }),
      ]);

      const result = await reader.breakdown({
        tenantId,
        workspaceId,
        agencyClientId: null,
        connectionId,
        kind: 'device_platform',
        since: '2026-10-01',
        until: '2026-10-01',
      });

      // Two buckets on one day is one covered day, not two.
      expect(result.coveredDays).toBe(1);
    });
  });

  /**
   * The daypart dimension, against the real constraint.
   *
   * Everything here is about the two properties that separate `hourly` from the
   * three audience dimensions: its buckets are ordinal, so the read has to
   * return them in clock order rather than by size, and its reach is inflated
   * by construction, so the read must refuse to total it — the same refusal as
   * the other dimensions but for a reason that bites much harder.
   */
  describe('the hourly dimension', () => {
    it('is accepted by the widened CHECK constraint', async () => {
      // The migration is the whole of Fatia B's schema change; if it has not
      // run, this insert fails instead of the assertion.
      const key = 'h07';

      await expect(
        writer.upsert([
          fact({
            breakdownKind: 'hourly',
            breakdownKey: key,
            metricDate: '2026-11-01',
          }),
        ]),
      ).resolves.toBeGreaterThan(0);
    });

    it('returns the dayparts in clock order, never by size', async () => {
      // The busiest hour is deliberately not the first one written, and not the
      // first one expected back: a daypart axis sorted by spend would put 16h
      // beside 07h and destroy the shape of the day, which is the only thing
      // the chart is read for.
      await writer.upsert([
        fact({
          breakdownKind: 'hourly',
          breakdownKey: 'h16',
          metricDate: '2026-11-02',
          spend: '90.000000',
          impressions: '900',
        }),
        fact({
          breakdownKind: 'hourly',
          breakdownKey: 'h00',
          metricDate: '2026-11-02',
          spend: '1.000000',
          impressions: '10',
        }),
        fact({
          breakdownKind: 'hourly',
          breakdownKey: 'h07',
          metricDate: '2026-11-02',
          spend: '50.000000',
          impressions: '500',
        }),
      ]);

      const result = await reader.breakdown({
        tenantId,
        workspaceId,
        agencyClientId: null,
        connectionId,
        kind: 'hourly',
        since: '2026-11-02',
        until: '2026-11-02',
      });

      expect(result.buckets.map((bucket) => bucket.key)).toEqual([
        'h00',
        'h07',
        'h16',
      ]);
    });

    it('labels each daypart as the hour it names', async () => {
      await writer.upsert([
        fact({
          breakdownKind: 'hourly',
          breakdownKey: 'h09',
          metricDate: '2026-11-03',
        }),
      ]);

      const result = await reader.breakdown({
        tenantId,
        workspaceId,
        agencyClientId: null,
        connectionId,
        kind: 'hourly',
        since: '2026-11-03',
        until: '2026-11-03',
      });

      expect(result.buckets.find((bucket) => bucket.key === 'h09')?.label).toBe(
        '09h',
      );
    });

    it('sums impressions across days but still refuses a period reach', async () => {
      // Both halves of the request "impressões e alcance por hora" in one test.
      // Impressions are counted once each, under the hour their viewer saw
      // them, so they add up. Reach counts the same person in every hour they
      // were reached in — measured at ~13% inflation on the production account
      // — so there is no period figure to return.
      await writer.upsert([
        fact({
          breakdownKind: 'hourly',
          breakdownKey: 'h20',
          metricDate: '2026-11-04',
          impressions: '120',
          reach: '80',
        }),
        fact({
          breakdownKind: 'hourly',
          breakdownKey: 'h20',
          metricDate: '2026-11-05',
          impressions: '130',
          reach: '90',
        }),
      ]);

      const result = await reader.breakdown({
        tenantId,
        workspaceId,
        agencyClientId: null,
        connectionId,
        kind: 'hourly',
        since: '2026-11-04',
        until: '2026-11-05',
      });

      const bucket = result.buckets.find((item) => item.key === 'h20');

      expect(bucket?.impressions).toBe('250');
      expect(bucket?.reach).toBeNull();
    });

    it('does not collide with another dimension using the same key text', async () => {
      // `breakdown_kind` is in the unique index for exactly this: Meta's
      // vocabularies overlap across dimensions, and a daypart key is short
      // enough to collide with something by accident.
      const key = 'h11';

      await writer.upsert([
        fact({
          breakdownKind: 'hourly',
          breakdownKey: key,
          metricDate: '2026-11-06',
          spend: '3.000000',
        }),
        fact({
          breakdownKind: 'device_platform',
          breakdownKey: key,
          metricDate: '2026-11-06',
          spend: '7.000000',
        }),
      ]);

      const rows = await query<{ breakdown_kind: string; spend: string }>(
        `SELECT "breakdown_kind", "spend" FROM "social_ad_breakdown_daily"
          WHERE "breakdown_key" = $1 AND "metric_date" = '2026-11-06'
          ORDER BY "breakdown_kind"`,
        [key],
      );

      expect(rows).toEqual([
        { breakdown_kind: 'device_platform', spend: '7.000000' },
        { breakdown_kind: 'hourly', spend: '3.000000' },
      ]);
    });
  });
});
