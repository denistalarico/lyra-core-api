import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialOrganicConnections1791500000000 } from './1791500000000-create-social-organic-connections';
import { CreateSocialOrganicReadModel1791900000000 } from './1791900000000-create-social-organic-read-model';

const run = describePostgresIntegration();

run('social organic read model migration against PostgreSQL', () => {
  let queryRunner: QueryRunner;
  const schema = `organic_metrics_probe_${randomUUID().replace(/-/g, '')}`;
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const connectionId = randomUUID();
  const assetId = randomUUID();

  const query = <T>(sql: string): Promise<T[]> =>
    queryRunner.query(sql) as Promise<T[]>;

  const tableExists = (name: string) =>
    query<{ reg: string | null }>(
      `SELECT to_regclass('${schema}.${name}') AS reg`,
    ).then((rows) => rows[0].reg !== null);

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

    queryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    await queryRunner.query(`CREATE SCHEMA "${schema}"`);
    await queryRunner.query(`SET LOCAL search_path TO "${schema}", public`);

    await new CreateSocialOrganicConnections1791500000000().up(queryRunner);
    await queryRunner.query(`
      INSERT INTO "social_organic_connections"
        ("id", "tenant_id", "workspace_id", "provider", "authorization_method")
      VALUES
        ('${connectionId}', '${tenantId}', '${workspaceId}', 'provider_probe', 'oauth_user')
    `);
    await queryRunner.query(`
      INSERT INTO "social_organic_assets"
        ("id", "tenant_id", "workspace_id", "connection_id", "provider",
         "asset_type", "external_asset_id")
      VALUES
        ('${assetId}', '${tenantId}', '${workspaceId}', '${connectionId}',
         'provider_probe', 'profile', 'asset_probe')
    `);
  });

  afterAll(async () => {
    if (queryRunner?.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    await queryRunner?.release();
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('migrates up on the agency datasource', async () => {
    await new CreateSocialOrganicReadModel1791900000000().up(queryRunner);

    for (const table of [
      'social_organic_post_metrics_daily',
      'social_organic_account_metrics_daily',
      'social_organic_sync_runs',
    ]) {
      expect(await tableExists(table)).toBe(true);
    }
  });

  it('stores counters above the signed 32-bit limit without overflow', async () => {
    const largeCounter = '9007199254740993';

    await queryRunner.query(`
      INSERT INTO "social_organic_post_metrics_daily"
        ("tenant_id", "workspace_id", "asset_id", "provider", "source",
         "external_publication_id", "metric_date", "asset_timezone",
         "impressions", "watch_time_seconds")
      VALUES
        ('${tenantId}', '${workspaceId}', '${assetId}', 'provider_probe', 'organic',
         'post_probe', '2026-09-07', 'America/Sao_Paulo',
         '${largeCounter}', '${largeCounter}')
    `);

    await queryRunner.query(`
      INSERT INTO "social_organic_account_metrics_daily"
        ("tenant_id", "workspace_id", "asset_id", "provider", "source",
         "metric_date", "asset_timezone", "followers_count")
      VALUES
        ('${tenantId}', '${workspaceId}', '${assetId}', 'provider_probe', 'organic',
         '2026-09-07', 'America/Sao_Paulo', '${largeCounter}')
    `);

    const [post] = await query<{
      impressions: string;
      watch_time_seconds: string;
    }>(`
      SELECT "impressions"::text, "watch_time_seconds"::text
      FROM "social_organic_post_metrics_daily"
      WHERE "asset_id" = '${assetId}'
    `);
    const [account] = await query<{ followers_count: string }>(`
      SELECT "followers_count"::text
      FROM "social_organic_account_metrics_daily"
      WHERE "asset_id" = '${assetId}'
    `);

    expect(post).toEqual({
      impressions: largeCounter,
      watch_time_seconds: largeCounter,
    });
    expect(account.followers_count).toBe(largeCounter);
  });

  it('migrates down and back up cleanly', async () => {
    const migration = new CreateSocialOrganicReadModel1791900000000();

    await migration.down(queryRunner);
    for (const table of [
      'social_organic_post_metrics_daily',
      'social_organic_account_metrics_daily',
      'social_organic_sync_runs',
    ]) {
      expect(await tableExists(table)).toBe(false);
    }
    expect(await tableExists('social_organic_assets')).toBe(true);

    await migration.up(queryRunner);
    for (const table of [
      'social_organic_post_metrics_daily',
      'social_organic_account_metrics_daily',
      'social_organic_sync_runs',
    ]) {
      expect(await tableExists(table)).toBe(true);
    }
  });
});
