import { randomUUID } from 'node:crypto';
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
  let writer: SocialAdBreakdownWriterService;
  let reader: SocialAdBreakdownReadService;

  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const connectionId = randomUUID();
  const otherConnectionId = randomUUID();

  const SYNCED_AT = new Date('2026-09-20T12:00:00.000Z');

  const query = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    AgencyDataSource.query<T[]>(sql, params);

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

    await AgencyDataSource.query('BEGIN');

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
      AgencyDataSource.getRepository(SocialAdBreakdownDailyEntity),
    );
    reader = new SocialAdBreakdownReadService(
      AgencyDataSource.getRepository(SocialAdAccountConnectionEntity),
      AgencyDataSource.getRepository(SocialAdBreakdownDailyEntity),
    );
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) {
      await AgencyDataSource.query('ROLLBACK');
      await AgencyDataSource.destroy();
    }
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
      await expect(
        writer.upsert([
          fact({
            breakdownKey: `negative-${randomUUID().slice(0, 8)}`,
            spend: '-1.000000',
          }),
        ]),
      ).rejects.toThrow();
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
});
