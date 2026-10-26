import { randomUUID } from 'crypto';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateLeadFlowAnalyticsReports1800900000000 } from './1800900000000-create-leadflow-analytics-reports';

const run = describePostgresIntegration();

run('leadflow analytics reports migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up, enforces the CHECKs and the FK, runs down, then up again', async () => {
    const migration = new CreateLeadFlowAnalyticsReports1800900000000();
    const queryRunner = AgencyDataSource.createQueryRunner();
    const tenant = randomUUID();
    const workspace = randomUUID();

    const insert = (columns: string, values: string, params: unknown[] = []) =>
      queryRunner.query(
        `INSERT INTO leadflow_analytics_reports
           (tenant_id, workspace_id, title, period_since, period_until${columns})
         VALUES ($1, $2, 'Relatório', '2026-09-01', '2026-09-30'${values})
         RETURNING id`,
        [tenant, workspace, ...params],
      ) as Promise<Array<{ id: string }>>;

    const expectRejected = async (
      savepoint: string,
      action: () => Promise<unknown>,
      constraint: RegExp,
    ) => {
      await queryRunner.query(`SAVEPOINT ${savepoint}`);
      await expect(action()).rejects.toThrow(constraint);
      await queryRunner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    };

    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // The disposable test database may already have this migration applied.
      await migration.down(queryRunner);
      await migration.up(queryRunner);

      const [dashboard] = (await queryRunner.query(
        `INSERT INTO leadflow_analytics_dashboards
           (tenant_id, workspace_id, name, is_default)
         VALUES ($1, $2, 'Comercial', false)
         RETURNING id`,
        [tenant, workspace],
      )) as Array<{ id: string }>;

      const [report] = await insert(
        ', dashboard_id, channels, page_mode',
        `, $3, '["overview","commercial"]'::jsonb, 'continuous'`,
        [dashboard.id],
      );

      await insert('', '');
      const [defaulted] = (await queryRunner.query(
        `SELECT page_mode, channels FROM leadflow_analytics_reports
          WHERE tenant_id = $1 AND dashboard_id IS NULL`,
        [tenant],
      )) as Array<{ page_mode: string; channels: unknown }>;
      expect(defaulted).toEqual({ page_mode: 'paginated', channels: [] });

      await expectRejected(
        'ck_page_mode',
        () => insert(', page_mode', `, 'booklet'`),
        /CK_leadflow_analytics_reports_page_mode/,
      );
      await expectRejected(
        'ck_period',
        () =>
          queryRunner.query(
            `INSERT INTO leadflow_analytics_reports
               (tenant_id, workspace_id, title, period_since, period_until)
             VALUES ($1, $2, 'x', '2026-09-30', '2026-09-01')`,
            [tenant, workspace],
          ),
        /CK_leadflow_analytics_reports_period/,
      );
      await expectRejected(
        'ck_channels',
        () => insert(', channels', `, '{"a":1}'::jsonb`),
        /CK_leadflow_analytics_reports_channels/,
      );
      await expectRejected(
        'fk_dashboard',
        () => insert(', dashboard_id', ', $3', [randomUUID()]),
        /FK_leadflow_analytics_reports_dashboard/,
      );

      // A report outlives the dashboard it came from.
      await queryRunner.query(
        'DELETE FROM leadflow_analytics_dashboards WHERE id = $1',
        [dashboard.id],
      );
      const [orphan] = (await queryRunner.query(
        'SELECT dashboard_id FROM leadflow_analytics_reports WHERE id = $1',
        [report.id],
      )) as Array<{ dashboard_id: string | null }>;
      expect(orphan?.dashboard_id).toBeNull();

      const indexes = (await queryRunner.query(
        `SELECT indexname FROM pg_indexes
          WHERE tablename = 'leadflow_analytics_reports' ORDER BY indexname`,
      )) as Array<{ indexname: string }>;
      expect(indexes.map((row) => row.indexname)).toEqual(
        expect.arrayContaining([
          'IDX_leadflow_analytics_reports_scope',
          'IDX_leadflow_analytics_reports_dashboard',
        ]),
      );

      await migration.down(queryRunner);
      const afterDown = (await queryRunner.query(
        `SELECT to_regclass('public.leadflow_analytics_reports') AS name`,
      )) as Array<{ name: string | null }>;
      expect(afterDown[0]?.name).toBeNull();

      await migration.up(queryRunner);
      const afterSecondUp = (await queryRunner.query(
        `SELECT to_regclass('public.leadflow_analytics_reports') AS name`,
      )) as Array<{ name: string | null }>;
      expect(afterSecondUp[0]?.name).toBe('leadflow_analytics_reports');
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });
});
