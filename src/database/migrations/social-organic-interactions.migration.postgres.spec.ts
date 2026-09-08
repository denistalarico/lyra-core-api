import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialOrganicInteractions1792300000000 } from './1792300000000-create-social-organic-interactions';

const run = describePostgresIntegration();

run('social organic interactions migration against PostgreSQL', () => {
  let queryRunner: QueryRunner;
  const schema = `organic_interaction_probe_${randomUUID().replace(/-/g, '')}`;

  const TENANT = randomUUID();
  const WORKSPACE = randomUUID();
  const ASSET = randomUUID();

  const query = <T>(sql: string): Promise<T[]> =>
    queryRunner.query(sql) as Promise<T[]>;

  const tableExists = (name: string) =>
    query<{ reg: string | null }>(
      `SELECT to_regclass('${schema}.${name}') AS reg`,
    ).then((rows) => rows[0].reg !== null);

  /** The upsert the service performs, expressed in raw SQL. */
  const upsert = (input: {
    externalId: string;
    type?: string;
    status?: string;
    text?: string | null;
    assetId?: string;
  }) =>
    queryRunner.query(`
      INSERT INTO "social_organic_interactions"
        ("tenant_id", "workspace_id", "asset_id", "provider", "surface",
         "interaction_type", "external_interaction_id", "text", "status", "occurred_at")
      VALUES ('${TENANT}', '${WORKSPACE}', '${input.assetId ?? ASSET}', 'meta', 'page_feed',
              '${input.type ?? 'comment_created'}', '${input.externalId}',
              ${input.text === undefined ? `'first'` : input.text === null ? 'NULL' : `'${input.text}'`},
              '${input.status ?? 'active'}', now())
      ON CONFLICT ("provider", "asset_id", "external_interaction_id")
      DO UPDATE SET "interaction_type" = EXCLUDED."interaction_type",
                    "status" = EXCLUDED."status",
                    "text" = EXCLUDED."text",
                    "updated_at" = now()
    `);

  /**
   * The suite runs inside one transaction that is rolled back at the end, so a
   * statement that is *supposed* to fail would otherwise abort it and take
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
    await new CreateSocialOrganicInteractions1792300000000().up(queryRunner);

    expect(await tableExists('social_organic_interactions')).toBe(true);
  });

  it('creates every declared index', async () => {
    const indexes = await query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
       WHERE schemaname = '${schema}'
         AND tablename = 'social_organic_interactions'
    `);
    const names = indexes.map((row) => row.indexname);

    for (const index of [
      'UQ_social_organic_interactions_external',
      'IDX_social_organic_interactions_scope',
      'IDX_social_organic_interactions_asset',
      'IDX_social_organic_interactions_content',
    ]) {
      expect(names).toContain(index);
    }
  });

  it('requires a scope — an interaction may not be tenantless', async () => {
    // Unlike the receipt, which must survive an unresolvable scope.
    await expectRejected(
      `INSERT INTO "social_organic_interactions"
         ("workspace_id", "asset_id", "provider", "surface", "interaction_type",
          "external_interaction_id", "occurred_at")
       VALUES ('${WORKSPACE}', '${ASSET}', 'meta', 'page_feed',
               'comment_created', 'orphan', now())`,
      '23502',
    );
  });

  it('rejects a duplicate (provider, asset, external id) at the database level', async () => {
    await upsert({ externalId: 'c-unique' });

    await expectRejected(
      `INSERT INTO "social_organic_interactions"
         ("tenant_id", "workspace_id", "asset_id", "provider", "surface",
          "interaction_type", "external_interaction_id", "occurred_at")
       VALUES ('${TENANT}', '${WORKSPACE}', '${ASSET}', 'meta', 'page_feed',
               'comment_created', 'c-unique', now())`,
      '23505',
    );
  });

  it('is idempotent: a redelivered comment writes exactly one row', async () => {
    await upsert({ externalId: 'c-retry' });
    await upsert({ externalId: 'c-retry' });
    await upsert({ externalId: 'c-retry' });

    const [row] = await query<{ count: string }>(`
      SELECT count(*) AS count FROM "social_organic_interactions"
       WHERE "external_interaction_id" = 'c-retry'
    `);
    expect(Number(row.count)).toBe(1);
  });

  it('converges an update onto the same row instead of inserting a second', async () => {
    await upsert({ externalId: 'c-edit', text: 'first' });
    await upsert({
      externalId: 'c-edit',
      type: 'comment_updated',
      text: 'second',
    });

    const rows = await query<{ interaction_type: string; text: string }>(`
      SELECT "interaction_type", "text" FROM "social_organic_interactions"
       WHERE "external_interaction_id" = 'c-edit'
    `);

    // The uniqueness key excludes interaction_type precisely so that a create
    // followed by an edit is one comment, not two.
    expect(rows).toHaveLength(1);
    expect(rows[0].interaction_type).toBe('comment_updated');
    expect(rows[0].text).toBe('second');
  });

  it('converges a removal onto the same row, keeping it visible as removed', async () => {
    await upsert({ externalId: 'c-remove' });
    await upsert({
      externalId: 'c-remove',
      type: 'comment_removed',
      status: 'removed',
      text: null,
    });

    const rows = await query<{ status: string; interaction_type: string }>(`
      SELECT "status", "interaction_type" FROM "social_organic_interactions"
       WHERE "external_interaction_id" = 'c-remove'
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('removed');
    expect(rows[0].interaction_type).toBe('comment_removed');
  });

  it('scopes uniqueness per asset, so two Pages may share a comment id', async () => {
    const otherAsset = randomUUID();
    await upsert({ externalId: 'shared-id' });
    await upsert({ externalId: 'shared-id', assetId: otherAsset });

    const [row] = await query<{ count: string }>(`
      SELECT count(*) AS count FROM "social_organic_interactions"
       WHERE "external_interaction_id" = 'shared-id'
    `);
    expect(Number(row.count)).toBe(2);
  });

  it('enforces the interaction type, surface and status vocabularies', async () => {
    await expectRejected(
      `INSERT INTO "social_organic_interactions"
         ("tenant_id", "workspace_id", "asset_id", "provider", "surface",
          "interaction_type", "external_interaction_id", "occurred_at")
       VALUES ('${TENANT}', '${WORKSPACE}', '${ASSET}', 'meta', 'page_feed',
               'comment_hidden', 'bad-type', now())`,
      '23514',
    );

    await expectRejected(
      `INSERT INTO "social_organic_interactions"
         ("tenant_id", "workspace_id", "asset_id", "provider", "surface",
          "interaction_type", "external_interaction_id", "occurred_at")
       VALUES ('${TENANT}', '${WORKSPACE}', '${ASSET}', 'meta', 'inbox_dm',
               'comment_created', 'bad-surface', now())`,
      '23514',
    );

    await expectRejected(
      `INSERT INTO "social_organic_interactions"
         ("tenant_id", "workspace_id", "asset_id", "provider", "surface",
          "interaction_type", "external_interaction_id", "status", "occurred_at")
       VALUES ('${TENANT}', '${WORKSPACE}', '${ASSET}', 'meta', 'page_feed',
               'comment_created', 'bad-status', 'deleted', now())`,
      '23514',
    );
  });

  it('defaults status to active and metadata to an empty object', async () => {
    await queryRunner.query(`
      INSERT INTO "social_organic_interactions"
        ("tenant_id", "workspace_id", "asset_id", "provider", "surface",
         "interaction_type", "external_interaction_id", "occurred_at")
      VALUES ('${TENANT}', '${WORKSPACE}', '${ASSET}', 'meta', 'instagram_mentions',
              'mention_created', 'defaults', now())
    `);

    const [row] = await query<{
      status: string;
      metadata: Record<string, unknown>;
      agency_client_id: string | null;
      text: string | null;
      source_webhook_event_id: string | null;
    }>(`
      SELECT "status", "metadata", "agency_client_id", "text", "source_webhook_event_id"
        FROM "social_organic_interactions"
       WHERE "external_interaction_id" = 'defaults'
    `);

    expect(row.status).toBe('active');
    expect(row.metadata).toEqual({});
    // NULL here is "the agency's own context", not "unknown".
    expect(row.agency_client_id).toBeNull();
    expect(row.text).toBeNull();
    expect(row.source_webhook_event_id).toBeNull();
  });

  it('keeps no foreign key, so an interaction outlives its asset and receipt', async () => {
    const constraints = await query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
       WHERE conrelid = '${schema}.social_organic_interactions'::regclass
         AND contype = 'f'
    `);

    expect(constraints).toHaveLength(0);
  });

  it('migrates down and back up cleanly', async () => {
    await new CreateSocialOrganicInteractions1792300000000().down(queryRunner);
    expect(await tableExists('social_organic_interactions')).toBe(false);

    await new CreateSocialOrganicInteractions1792300000000().up(queryRunner);
    expect(await tableExists('social_organic_interactions')).toBe(true);

    const indexes = await query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
       WHERE schemaname = '${schema}'
         AND tablename = 'social_organic_interactions'
    `);
    expect(indexes.map((row) => row.indexname)).toContain(
      'UQ_social_organic_interactions_external',
    );
  });
});
