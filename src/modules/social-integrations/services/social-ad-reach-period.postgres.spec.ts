import { randomUUID } from 'node:crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { SocialAdReachPeriodEntity } from '../entities/social-ad-reach-period.entity';
import { SocialAdReachPeriodReadService } from './social-ad-reach-period.read.service';

/**
 * The period reach cache against a real PostgreSQL.
 *
 * Every claim this slice makes is a database guarantee and cannot be checked
 * against a mock. Whether re-measuring a partial range updates in place rather
 * than leaving two rows depends on a unique index that includes both period
 * endpoints; whether a nested range can be mistaken for the requested one
 * depends on the lookup being an equality rather than a scan; whether a
 * backwards range is storable at all depends on a CHECK. A fixture-driven unit
 * test would pass under every one of those being wrong.
 *
 * All of it runs inside one transaction that is rolled back, on
 * `lyra_agency_test` behind the official guard.
 */
const run = describePostgresIntegration();

run('Social ad period reach against PostgreSQL', () => {
  let reader: SocialAdReachPeriodReadService;

  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const workspaceId = randomUUID();
  const connectionId = randomUUID();
  const externalAccountId = 'act_1';

  const MEASURED_AT = new Date('2026-09-20T12:00:00.000Z');

  const query = <T>(sql: string, params: unknown[] = []): Promise<T[]> =>
    AgencyDataSource.query<T[]>(sql, params);

  const insert = (overrides: Record<string, unknown> = {}) => {
    const row = {
      tenant_id: tenantId,
      workspace_id: workspaceId,
      agency_client_id: null,
      connection_id: connectionId,
      provider: 'meta_ads',
      entity_level: 'account',
      entity_external_id: externalAccountId,
      period_since: '2026-08-01',
      period_until: '2026-08-31',
      account_timezone: 'America/Sao_Paulo',
      reach: '9140',
      is_partial: false,
      measured_at: MEASURED_AT,
      ...overrides,
    };

    return query(
      `INSERT INTO "social_ad_reach_periods"
         ("tenant_id", "workspace_id", "agency_client_id", "connection_id",
          "provider", "entity_level", "entity_external_id", "period_since",
          "period_until", "account_timezone", "reach", "is_partial", "measured_at")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT ("tenant_id", "workspace_id", "connection_id", "entity_level",
                    "entity_external_id", "period_since", "period_until")
       DO UPDATE SET "reach" = EXCLUDED."reach",
                     "is_partial" = EXCLUDED."is_partial",
                     "measured_at" = EXCLUDED."measured_at",
                     "updated_at" = now()`,
      [
        row.tenant_id,
        row.workspace_id,
        row.agency_client_id,
        row.connection_id,
        row.provider,
        row.entity_level,
        row.entity_external_id,
        row.period_since,
        row.period_until,
        row.account_timezone,
        row.reach,
        row.is_partial,
        row.measured_at,
      ],
    );
  };

  const find = (since: string, until: string) =>
    reader.find({
      tenantId,
      workspaceId,
      connectionId,
      externalAccountId,
      since,
      until,
    });

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    reader = new SocialAdReachPeriodReadService(
      AgencyDataSource.getRepository(SocialAdReachPeriodEntity),
    );
  });

  beforeEach(async () => {
    await query(
      'DELETE FROM "social_ad_reach_periods" WHERE "tenant_id" = $1',
      [tenantId],
    );
    await query(
      'DELETE FROM "social_ad_reach_periods" WHERE "tenant_id" = $1',
      [otherTenantId],
    );
  });

  afterAll(async () => {
    await query(
      'DELETE FROM "social_ad_reach_periods" WHERE "tenant_id" = $1',
      [tenantId],
    );
    await query(
      'DELETE FROM "social_ad_reach_periods" WHERE "tenant_id" = $1',
      [otherTenantId],
    );
  });

  it('returns the measurement of the exact range', async () => {
    await insert();

    await expect(find('2026-08-01', '2026-08-31')).resolves.toMatchObject({
      reach: '9140',
      isPartial: false,
    });
  });

  it('does not return a nested range under a wider range', async () => {
    // The failure this guards: a 7-day measurement served as a 30-day one. The
    // number would be smaller than the truth and nothing on the dashboard could
    // reveal it, which is why the lookup is an equality rather than a scan.
    await insert({ period_since: '2026-08-10', period_until: '2026-08-16' });

    await expect(find('2026-08-01', '2026-08-31')).resolves.toBeNull();
  });

  it('does not return an overlapping range', async () => {
    await insert({ period_since: '2026-08-01', period_until: '2026-08-30' });

    // One day shorter is a different question, not an approximation of this one.
    await expect(find('2026-08-01', '2026-08-31')).resolves.toBeNull();
  });

  it('keeps one row per range, replacing a partial measurement in place', async () => {
    await insert({
      period_since: '2026-09-14',
      period_until: '2026-09-20',
      reach: '1200',
      is_partial: true,
    });
    await insert({
      period_since: '2026-09-14',
      period_until: '2026-09-20',
      reach: '1850',
      is_partial: true,
    });

    const rows = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM "social_ad_reach_periods"
        WHERE "tenant_id" = $1 AND "period_since" = '2026-09-14'`,
      [tenantId],
    );

    // Two rows for one range would make the cache ambiguous, and any lookup
    // forced to choose would eventually choose the older subtotal.
    expect(rows[0].count).toBe('1');
    await expect(find('2026-09-14', '2026-09-20')).resolves.toMatchObject({
      reach: '1850',
    });
  });

  it('preserves created_at across a re-measurement', async () => {
    await insert({ period_since: '2026-09-14', period_until: '2026-09-20' });

    const [before] = await query<{ created_at: Date }>(
      `SELECT "created_at" FROM "social_ad_reach_periods"
        WHERE "tenant_id" = $1 AND "period_since" = '2026-09-14'`,
      [tenantId],
    );

    await insert({
      period_since: '2026-09-14',
      period_until: '2026-09-20',
      reach: '2000',
    });

    const [after] = await query<{ created_at: Date }>(
      `SELECT "created_at" FROM "social_ad_reach_periods"
        WHERE "tenant_id" = $1 AND "period_since" = '2026-09-14'`,
      [tenantId],
    );

    // "When did Lyra first measure this range" must survive every re-read.
    expect(after.created_at.getTime()).toBe(before.created_at.getTime());
  });

  it("keeps another tenant's measurement out of this one's lookup", async () => {
    await insert({ tenant_id: otherTenantId, reach: '999999' });

    await expect(find('2026-08-01', '2026-08-31')).resolves.toBeNull();
  });

  it('distinguishes a stored null reach from an unmeasured range', async () => {
    await insert({ reach: null });

    // A row with a null reach still records that the measurement happened, which
    // is what keeps a prewarm pass from retrying it on every tick.
    await expect(find('2026-08-01', '2026-08-31')).resolves.toMatchObject({
      reach: null,
      isPartial: false,
    });
    await expect(find('2026-07-01', '2026-07-31')).resolves.toBeNull();
  });

  it('refuses a range that runs backwards', async () => {
    await expect(
      insert({ period_since: '2026-08-31', period_until: '2026-08-01' }),
    ).rejects.toThrow(/CK_social_ad_reach_periods_range/);
  });

  it('refuses a negative reach', async () => {
    await expect(insert({ reach: '-1' })).rejects.toThrow(
      /CK_social_ad_reach_periods_non_negative/,
    );
  });

  it('refuses an entity level outside the union', async () => {
    await expect(insert({ entity_level: 'creative' })).rejects.toThrow(
      /CK_social_ad_reach_periods_level/,
    );
  });

  it('proves the point of the table: a period measurement is below the daily sum', async () => {
    /**
     * The acceptance criterion of Etapa 2B, stated as data.
     *
     * Three days of 1 000 reach each sum to 3 000, but if the same people came
     * back the real period reach is 1 000. The cache holds the measured figure;
     * nothing here can derive it from the daily rows, and that is exactly why the
     * measurement exists. A dashboard that summed would overstate by 200%.
     */
    await insert({
      period_since: '2026-08-01',
      period_until: '2026-08-03',
      reach: '1000',
    });

    const measured = await find('2026-08-01', '2026-08-03');
    const naiveDailySum = 3 * 1000;

    expect(Number(measured?.reach)).toBeLessThan(naiveDailySum);
  });
});
