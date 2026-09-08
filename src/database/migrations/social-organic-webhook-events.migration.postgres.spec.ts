import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialOrganicWebhookEvents1792200000000 } from './1792200000000-create-social-organic-webhook-events';

const run = describePostgresIntegration();

run('social organic webhook events migration against PostgreSQL', () => {
  let queryRunner: QueryRunner;
  const schema = `organic_webhook_probe_${randomUUID().replace(/-/g, '')}`;

  const query = <T>(sql: string): Promise<T[]> =>
    queryRunner.query(sql) as Promise<T[]>;

  const tableExists = (name: string) =>
    query<{ reg: string | null }>(
      `SELECT to_regclass('${schema}.${name}') AS reg`,
    ).then((rows) => rows[0].reg !== null);

  const insert = (eventKey: string) =>
    queryRunner.query(`
      INSERT INTO "social_organic_webhook_events"
        ("provider", "event_key", "object_type")
      VALUES ('meta', '${eventKey}', 'page')
    `);

  /**
   * The whole suite runs inside one transaction that is rolled back at the end,
   * so a statement that is *supposed* to fail would otherwise abort it and take
   * every later assertion with it. A savepoint contains the failure.
   */
  const expectRejected = async (sql: string, code: string): Promise<void> => {
    const savepoint = `sp_${randomUUID().replace(/-/g, '')}`;
    await queryRunner.query(`SAVEPOINT "${savepoint}"`);

    let thrown: unknown;
    try {
      await queryRunner.query(sql);
    } catch (error) {
      thrown = error;
    } finally {
      await queryRunner.query(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
    }

    expect(thrown).toMatchObject({ code });
  };

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    queryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    await queryRunner.query(`CREATE SCHEMA "${schema}"`);
    await queryRunner.query(`SET LOCAL search_path TO "${schema}", public`);
  });

  afterAll(async () => {
    if (queryRunner?.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    await queryRunner?.release();
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('migrates up on the agency datasource', async () => {
    await new CreateSocialOrganicWebhookEvents1792200000000().up(queryRunner);

    expect(await tableExists('social_organic_webhook_events')).toBe(true);
  });

  it('creates every declared index', async () => {
    const indexes = await query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
       WHERE schemaname = '${schema}'
         AND tablename = 'social_organic_webhook_events'
    `);
    const names = indexes.map((row) => row.indexname);

    for (const index of [
      'UQ_social_organic_webhook_events_key',
      'IDX_social_organic_webhook_events_queue',
      'IDX_social_organic_webhook_events_stale_lock',
      'IDX_social_organic_webhook_events_scope',
      'IDX_social_organic_webhook_events_asset',
    ]) {
      expect(names).toContain(index);
    }
  });

  it('accepts a fully unresolved row — scope columns are nullable', async () => {
    await insert('meta:sha256:unresolved');

    const [row] = await query<{
      tenant_id: string | null;
      asset_id: string | null;
      scope_resolution: string;
      status: string;
      attempts: number;
    }>(`
      SELECT "tenant_id", "asset_id", "scope_resolution", "status", "attempts"
        FROM "social_organic_webhook_events"
       WHERE "event_key" = 'meta:sha256:unresolved'
    `);

    expect(row.tenant_id).toBeNull();
    expect(row.asset_id).toBeNull();
    expect(row.scope_resolution).toBe('unresolved_no_asset_id');
    expect(row.status).toBe('received');
    expect(Number(row.attempts)).toBe(0);
  });

  it('rejects a duplicate (provider, event_key) at the database level', async () => {
    await insert('meta:sha256:duplicate');

    await expectRejected(
      `INSERT INTO "social_organic_webhook_events"
         ("provider", "event_key", "object_type")
       VALUES ('meta', 'meta:sha256:duplicate', 'page')`,
      '23505',
    );
  });

  it('allows the same event_key under a different provider', async () => {
    await queryRunner.query(`
      INSERT INTO "social_organic_webhook_events"
        ("provider", "event_key", "object_type")
      VALUES ('other_provider', 'meta:sha256:duplicate', 'page')
    `);

    const [row] = await query<{ count: string }>(`
      SELECT COUNT(*) AS count FROM "social_organic_webhook_events"
       WHERE "event_key" = 'meta:sha256:duplicate'
    `);
    expect(Number(row.count)).toBe(2);
  });

  it('rejects a status outside the vocabulary', async () => {
    await expectRejected(
      `INSERT INTO "social_organic_webhook_events"
         ("provider", "event_key", "object_type", "status")
       VALUES ('meta', 'meta:sha256:badstatus', 'page', 'whatever')`,
      '23514',
    );
  });

  it('rejects a scope_resolution outside the vocabulary', async () => {
    await expectRejected(
      `INSERT INTO "social_organic_webhook_events"
         ("provider", "event_key", "object_type", "scope_resolution")
       VALUES ('meta', 'meta:sha256:badscope', 'page', 'probably_fine')`,
      '23514',
    );
  });

  it('stores and returns the raw payload as jsonb', async () => {
    await queryRunner.query(`
      INSERT INTO "social_organic_webhook_events"
        ("provider", "event_key", "object_type", "raw_payload")
      VALUES ('meta', 'meta:sha256:payload', 'page',
              '{"object":"page","entry":[{"id":"page-1"}]}'::jsonb)
    `);

    const [row] = await query<{ raw_payload: Record<string, unknown> }>(`
      SELECT "raw_payload" FROM "social_organic_webhook_events"
       WHERE "event_key" = 'meta:sha256:payload'
    `);

    expect(row.raw_payload).toEqual({
      object: 'page',
      entry: [{ id: 'page-1' }],
    });
  });

  it('migrates down and back up cleanly', async () => {
    const migration = new CreateSocialOrganicWebhookEvents1792200000000();

    await migration.down(queryRunner);
    expect(await tableExists('social_organic_webhook_events')).toBe(false);

    await migration.up(queryRunner);
    expect(await tableExists('social_organic_webhook_events')).toBe(true);
  });
});

/**
 * Concurrency needs real, separate sessions, so it cannot live inside the
 * transaction-wrapped suite above.
 */
run('social organic webhook dedupe under concurrency', () => {
  const schema = `organic_webhook_race_${randomUUID().replace(/-/g, '')}`;

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    const setup = AgencyDataSource.createQueryRunner();
    await setup.connect();
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`SET search_path TO "${schema}", public`);
    await new CreateSocialOrganicWebhookEvents1792200000000().up(setup);
    await setup.release();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) {
      const teardown = AgencyDataSource.createQueryRunner();
      await teardown.connect();
      await teardown.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await teardown.release();
      await AgencyDataSource.destroy();
    }
  });

  it('lets exactly one of many simultaneous redeliveries win', async () => {
    const eventKey = `meta:sha256:${randomUUID().replace(/-/g, '')}`;

    // What a Meta retry storm looks like: the same delivery, at once, on
    // separate connections. Only the unique index can arbitrate this.
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, async () => {
        const runner = AgencyDataSource.createQueryRunner();
        await runner.connect();
        try {
          await runner.query(`SET search_path TO "${schema}", public`);
          await runner.query(`
            INSERT INTO "social_organic_webhook_events"
              ("provider", "event_key", "object_type")
            VALUES ('meta', '${eventKey}', 'page')
          `);
        } finally {
          await runner.release();
        }
      }),
    );

    const inserted = attempts.filter((a) => a.status === 'fulfilled').length;
    const rejected = attempts.filter((a) => a.status === 'rejected');

    expect(inserted).toBe(1);
    expect(rejected).toHaveLength(7);
    for (const failure of rejected) {
      expect(failure.reason).toMatchObject({
        code: '23505',
      });
    }

    const check = AgencyDataSource.createQueryRunner();
    await check.connect();
    await check.query(`SET search_path TO "${schema}", public`);
    const rows = (await check.query(
      `SELECT COUNT(*) AS count FROM "social_organic_webhook_events"
        WHERE "event_key" = '${eventKey}'`,
    )) as Array<{ count: string }>;
    await check.release();

    expect(Number(rows[0].count)).toBe(1);
  });
});
