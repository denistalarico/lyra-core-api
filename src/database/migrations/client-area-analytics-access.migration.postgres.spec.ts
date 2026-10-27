import { randomUUID } from 'crypto';
import type { QueryRunner } from 'typeorm';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { AddClientAreaAnalyticsAccess1801300000000 } from './1801300000000-add-client-area-analytics-access';

const run = describePostgresIntegration();

async function rows<T>(
  queryRunner: QueryRunner,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await queryRunner.query(sql, params)) as T[];
}

/** Runs `sql` in a savepoint and reports whether PostgreSQL refused it. */
async function refused(
  queryRunner: QueryRunner,
  sql: string,
  params: unknown[],
): Promise<string | null> {
  await queryRunner.query('SAVEPOINT ca_an1');
  try {
    await queryRunner.query(sql, params);
    await queryRunner.query('RELEASE SAVEPOINT ca_an1');
    return null;
  } catch (error) {
    await queryRunner.query('ROLLBACK TO SAVEPOINT ca_an1');
    return (error as { code?: string }).code ?? 'error';
  }
}

run('CA-AN1 client area analytics access migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('adds the order column, the owner column with its CHECK and owner-aware name indexes; down/up round-trips', async () => {
    const migration = new AddClientAreaAnalyticsAccess1801300000000();
    const queryRunner = AgencyDataSource.createQueryRunner();
    const tenant = randomUUID();
    const workspace = randomUUID();
    const client = randomUUID();
    const company = randomUUID();
    const ownerA = randomUUID();
    const ownerB = randomUUID();

    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // The disposable database may already hold this migration.
      await migration.down(queryRunner);
      await migration.up(queryRunner);
      // Idempotent: the spec suite may run `up` twice.
      await migration.up(queryRunner);

      const [order] = await rows<{
        column_default: string;
        is_nullable: string;
      }>(
        queryRunner,
        `SELECT column_default, is_nullable FROM information_schema.columns
          WHERE table_name = 'client_area_company_settings' AND column_name = 'analytics_overview_first'`,
      );
      expect(order).toMatchObject({ is_nullable: 'NO' });
      expect(order.column_default).toContain('leadflow');
      const [check] = await rows<{ def: string }>(
        queryRunner,
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'CK_client_area_company_settings_analytics_overview_first'`,
      );
      expect(check.def).toContain('leadflow');
      expect(check.def).toContain('social');

      for (const table of [
        'social_analytics_dashboards',
        'leadflow_analytics_dashboards',
      ]) {
        const insert = `INSERT INTO ${table}
          (tenant_id, workspace_id, agency_client_id, company_context_id, name, is_default, channel_key, client_area_owner_user_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
        const channel =
          table === 'social_analytics_dashboards' ? 'instagram' : 'service';
        // Shared and private rows with the same name live side by side.
        expect(
          await refused(queryRunner, insert, [
            tenant,
            workspace,
            client,
            company,
            'Meu painel',
            false,
            null,
            null,
          ]),
        ).toBeNull();
        for (const owner of [ownerA, ownerB])
          expect(
            await refused(queryRunner, insert, [
              tenant,
              workspace,
              client,
              company,
              'Meu painel',
              false,
              null,
              owner,
            ]),
          ).toBeNull();
        // One Owner cannot name two private dashboards alike.
        expect(
          await refused(queryRunner, insert, [
            tenant,
            workspace,
            client,
            company,
            ' meu PAINEL ',
            false,
            null,
            ownerA,
          ]),
        ).toBe('23505');
        // A private row is never the Visão Geral, a channel screen or agency root.
        expect(
          await refused(queryRunner, insert, [
            tenant,
            workspace,
            client,
            company,
            'Default privado',
            true,
            null,
            ownerA,
          ]),
        ).toBe('23514');
        expect(
          await refused(queryRunner, insert, [
            tenant,
            workspace,
            client,
            company,
            'Canal privado',
            false,
            channel,
            ownerA,
          ]),
        ).toBe('23514');
        expect(
          await refused(queryRunner, insert, [
            tenant,
            workspace,
            null,
            null,
            'Raiz privada',
            false,
            null,
            ownerA,
          ]),
        ).toBe('23514');
      }

      await migration.down(queryRunner);
      for (const table of [
        'social_analytics_dashboards',
        'leadflow_analytics_dashboards',
      ]) {
        const columns = await rows<unknown>(
          queryRunner,
          `SELECT 1 FROM information_schema.columns
            WHERE table_name = $1 AND column_name = 'client_area_owner_user_id'`,
          [table],
        );
        expect(columns).toHaveLength(0);
        // Private rows went with the column; the shared one stays.
        const counted = await rows<{ count: string }>(
          queryRunner,
          `SELECT count(*)::text AS count FROM ${table} WHERE tenant_id = $1`,
          [tenant],
        );
        expect(counted[0].count).toBe('1');
      }
      const [indexDef] = await rows<{ indexdef: string }>(
        queryRunner,
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_leadflow_dashboards_name'`,
      );
      expect(indexDef.indexdef).not.toContain('client_area_owner_user_id');
      expect(
        await rows<unknown>(
          queryRunner,
          `SELECT 1 FROM information_schema.columns
            WHERE table_name = 'client_area_company_settings' AND column_name = 'analytics_overview_first'`,
        ),
      ).toHaveLength(0);

      await migration.up(queryRunner);
      const indexes = await rows<{ indexdef: string }>(
        queryRunner,
        `SELECT indexdef FROM pg_indexes
          WHERE indexname IN ('UQ_leadflow_dashboards_name', 'UQ_social_analytics_dashboards_name_company')`,
      );
      expect(indexes).toHaveLength(2);
      for (const index of indexes)
        expect(index.indexdef).toContain('client_area_owner_user_id');
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });
});
