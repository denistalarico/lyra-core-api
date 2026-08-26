import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialAdReadModel1790400000000 } from './1790400000000-create-social-ad-read-model';

/**
 * The migration run for real, then rolled back.
 *
 * Postgres makes DDL transactional, so `up()` and `down()` can be exercised
 * against the live schema without leaving anything behind — which is the only
 * way to find out whether a constraint the string-level spec merely *contains*
 * is one the database will actually accept. A CHECK that Postgres rejects
 * (a non-immutable expression, a typo in a column reference) passes every
 * assertion about SQL text and fails the first time it is deployed.
 *
 * Gated behind the same flag as the other PostgreSQL specs: it needs a
 * database, and CI without one must skip rather than fail.
 */
const run =
  process.env.INBOX_PG_INTEGRATION === 'true' ? describe : describe.skip;

run('social ad read model migration against PostgreSQL', () => {
  let queryRunner: QueryRunner;
  const connectionId = randomUUID();
  const tenantId = randomUUID();
  const workspaceId = randomUUID();

  /** `queryRunner.query` is typed `any`; every read below goes through here. */
  const query = <T>(sql: string): Promise<T[]> =>
    queryRunner.query(sql) as Promise<T[]>;

  /** Runs a statement expected to fail, without poisoning the transaction. */
  async function violation(sql: string): Promise<string> {
    await queryRunner.query('SAVEPOINT attempt');
    try {
      await queryRunner.query(sql);
      await queryRunner.query('RELEASE SAVEPOINT attempt');
      return 'no error';
    } catch (error) {
      await queryRunner.query('ROLLBACK TO SAVEPOINT attempt');
      return (error as { code?: string }).code ?? 'unknown';
    }
  }

  const tableExists = (name: string) =>
    query<{ reg: string | null }>(
      `SELECT to_regclass('public.${name}') AS reg`,
    ).then((rows) => rows[0].reg !== null);

  async function insertFact(
    overrides: Record<string, string> = {},
  ): Promise<unknown[]> {
    const values = {
      tenant_id: `'${tenantId}'`,
      workspace_id: `'${workspaceId}'`,
      connection_id: `'${connectionId}'`,
      provider: `'meta_ads'`,
      entity_level: `'campaign'`,
      entity_external_id: `'23851234567890123'`,
      metric_date: `'2026-08-20'`,
      account_timezone: `'America/Sao_Paulo'`,
      ...overrides,
    };

    return query(`
      INSERT INTO "social_ad_metrics_daily"
        (${Object.keys(values)
          .map((column) => `"${column}"`)
          .join(', ')})
      VALUES (${Object.values(values).join(', ')})
    `);
  }

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    queryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    // A connection row to hang the foreign keys on, created inside the same
    // transaction so it disappears with everything else.
    await queryRunner.query(`
      INSERT INTO "social_ad_account_connections"
        ("id", "tenant_id", "workspace_id", "provider", "external_account_id")
      VALUES ('${connectionId}', '${tenantId}', '${workspaceId}', 'meta_ads', 'act_dry_run')
    `);
  });

  afterAll(async () => {
    // Nothing above is meant to survive: the transaction is the cleanup.
    if (queryRunner?.isTransactionActive)
      await queryRunner.rollbackTransaction();
    await queryRunner?.release();
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('starts from a schema that does not have these tables yet', async () => {
    // If this fails, the migration was already applied and every assertion
    // below would be testing the deployed schema instead of this file.
    for (const table of [
      'social_ad_entities',
      'social_ad_sync_runs',
      'social_ad_metrics_daily',
    ]) {
      expect(await tableExists(table)).toBe(false);
    }
  });

  it('applies cleanly', async () => {
    await new CreateSocialAdReadModel1790400000000().up(queryRunner);

    for (const table of [
      'social_ad_entities',
      'social_ad_sync_runs',
      'social_ad_metrics_daily',
    ]) {
      expect(await tableExists(table)).toBe(true);
    }
  });

  it('requires a source and an attribution setting on every fact', async () => {
    const columns = await query<{ column_name: string; is_nullable: string }>(`
        SELECT "column_name", "is_nullable"
        FROM information_schema.columns
        WHERE "table_name" = 'social_ad_metrics_daily'
          AND "column_name" IN ('source', 'attribution_setting', 'account_timezone', 'metric_date')
      `);

    expect(columns).toHaveLength(4);
    for (const column of columns) {
      expect(column.is_nullable).toBe('NO');
    }
  });

  it('keys a fact by source and attribution setting, as Postgres sees it', async () => {
    const [index] = await query<{ def: string }>(`
      SELECT pg_get_indexdef(i.indexrelid) AS def
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = 'UQ_social_ad_metrics_daily_fact'
    `);

    expect(index.def).toContain('UNIQUE');
    expect(index.def).toContain('source');
    expect(index.def).toContain('attribution_setting');
  });

  it('rejects the duplicate a re-read would otherwise create', async () => {
    await insertFact();

    // Same object, same day, same everything: this is what Meta restating a
    // window looks like, and it must collide so the ingest can upsert.
    await queryRunner.query('SAVEPOINT duplicate');
    await expect(insertFact()).rejects.toMatchObject({ code: '23505' });
    await queryRunner.query('ROLLBACK TO SAVEPOINT duplicate');
  });

  it('lets a second attribution window land beside the first', async () => {
    // The same day measured another way is a new fact, not a correction.
    await expect(
      insertFact({ attribution_setting: `'7d_click'` }),
    ).resolves.toBeDefined();
  });

  it('refuses numbers that could only come from a parsing bug', async () => {
    expect(
      await violation(`UPDATE "social_ad_metrics_daily" SET "spend" = -1`),
    ).toBe('23514');
    expect(
      await violation(
        `UPDATE "social_ad_metrics_daily" SET "impressions" = -5`,
      ),
    ).toBe('23514');
  });

  it('accepts a date the database server would call tomorrow', async () => {
    // The proof that no CURRENT_DATE bound survived: an account east of the
    // server legitimately has one for part of every day.
    await expect(
      insertFact({ metric_date: `(CURRENT_DATE + 2)::text::date` }),
    ).resolves.toBeDefined();
  });

  it('refuses an account with a parent', async () => {
    const insert = (level: string, parent: string) => `
      INSERT INTO "social_ad_entities"
        ("tenant_id", "workspace_id", "connection_id", "provider", "entity_level",
         "external_id", "parent_external_id")
      VALUES ('${tenantId}', '${workspaceId}', '${connectionId}', 'meta_ads',
              '${level}', '${randomUUID()}', ${parent})
    `;

    expect(await violation(insert('account', `'act_999'`))).toBe('23514');
    expect(await violation(insert('account', 'NULL'))).toBe('no error');
    expect(await violation(insert('adset', `'act_999'`))).toBe('no error');
    expect(await violation(insert('supergroup', 'NULL'))).toBe('23514');
  });

  it('holds the run state machine and the window to seven states and one order', async () => {
    const insertRun = (status: string, start: string, end: string) => `
      INSERT INTO "social_ad_sync_runs"
        ("tenant_id", "workspace_id", "connection_id", "provider", "run_kind",
         "status", "window_start", "window_end", "idempotency_key")
      VALUES ('${tenantId}', '${workspaceId}', '${connectionId}', 'meta_ads',
              'insights', '${status}', ${start}, ${end}, '${randomUUID()}')
    `;

    expect(
      await violation(insertRun('partial', `'2026-08-01'`, `'2026-08-07'`)),
    ).toBe('no error');
    expect(
      await violation(insertRun('almost', `'2026-08-01'`, `'2026-08-07'`)),
    ).toBe('23514');
    // A hierarchy sync has no window at all.
    expect(await violation(insertRun('queued', 'NULL', 'NULL'))).toBe(
      'no error',
    );
    expect(
      await violation(insertRun('queued', `'2026-08-09'`, `'2026-08-01'`)),
    ).toBe('23514');
  });

  it('collapses a double enqueue while one run is still live', async () => {
    const key = 'insights:2026-08-20';
    const insertRun = (status: string) => `
      INSERT INTO "social_ad_sync_runs"
        ("tenant_id", "workspace_id", "connection_id", "provider", "run_kind",
         "status", "idempotency_key")
      VALUES ('${tenantId}', '${workspaceId}', '${connectionId}', 'meta_ads',
              'insights', '${status}', '${key}')
    `;

    expect(await violation(insertRun('queued'))).toBe('no error');
    expect(await violation(insertRun('processing'))).toBe('23505');
    // The same intent a week later, once the first run has settled, is a
    // legitimate re-run rather than a duplicate.
    expect(await violation(insertRun('succeeded'))).toBe('no error');
    expect(await violation(insertRun('succeeded'))).toBe('no error');
  });

  it('detaches facts from a deleted run and takes them with a deleted connection', async () => {
    const runId = randomUUID();
    await queryRunner.query(`
      INSERT INTO "social_ad_sync_runs"
        ("id", "tenant_id", "workspace_id", "connection_id", "provider",
         "run_kind", "idempotency_key")
      VALUES ('${runId}', '${tenantId}', '${workspaceId}', '${connectionId}',
              'meta_ads', 'insights', 'cascade-probe')
    `);
    await insertFact({
      entity_external_id: `'cascade-probe'`,
      sync_run_id: `'${runId}'`,
    });

    await queryRunner.query(
      `DELETE FROM "social_ad_sync_runs" WHERE "id" = '${runId}'`,
    );
    const [orphan] = await query<{ sync_run_id: string | null }>(
      `SELECT "sync_run_id" FROM "social_ad_metrics_daily"
       WHERE "entity_external_id" = 'cascade-probe'`,
    );
    // The run log is prunable; the spend it produced is not.
    expect(orphan.sync_run_id).toBeNull();

    await queryRunner.query(
      `DELETE FROM "social_ad_account_connections" WHERE "id" = '${connectionId}'`,
    );
    for (const table of [
      'social_ad_metrics_daily',
      'social_ad_entities',
      'social_ad_sync_runs',
    ]) {
      const [{ count }] = await query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "${table}"
         WHERE "connection_id" = '${connectionId}'`,
      );
      expect(count).toBe('0');
    }
  });

  it('rolls back to nothing', async () => {
    await new CreateSocialAdReadModel1790400000000().down(queryRunner);

    for (const table of [
      'social_ad_entities',
      'social_ad_sync_runs',
      'social_ad_metrics_daily',
    ]) {
      expect(await tableExists(table)).toBe(false);
    }
    // And S1's table, which this migration does not own, is untouched.
    expect(await tableExists('social_ad_account_connections')).toBe(true);
  });
});
