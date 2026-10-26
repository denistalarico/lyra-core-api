import { randomUUID } from 'crypto';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateAnalyticsOverviewHeaders1801200000000 } from './1801200000000-create-analytics-overview-headers';

const run = describePostgresIntegration();

type HeaderRow = {
  agency_client_id: string | null;
  company_context_id: string | null;
  title: string;
  description: string | null;
};

run('analytics overview headers migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up with seed, enforces the scope rules, runs down, then up again', async () => {
    const migration = new CreateAnalyticsOverviewHeaders1801200000000();
    const queryRunner = AgencyDataSource.createQueryRunner();
    const tenant = randomUUID();
    const workspace = randomUUID();
    const clientBoth = randomUUID();
    const companyBoth = randomUUID();
    const clientLeadflow = randomUUID();
    const companyLeadflow = randomUUID();
    const legacyClient = randomUUID();

    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // The disposable test database may already have this migration applied.
      await migration.down(queryRunner);

      // Agency root: Social and LeadFlow overviews — Social wins.
      await queryRunner.query(
        `INSERT INTO social_analytics_dashboards
           (tenant_id, workspace_id, name, description, is_default)
         VALUES ($1, $2, 'Visão Geral', 'Principais métricas de todos os canais', true),
                ($1, $2, 'Outro painel', 'não é a visão geral', false)`,
        [tenant, workspace],
      );
      await queryRunner.query(
        `INSERT INTO leadflow_analytics_dashboards
           (tenant_id, workspace_id, name, description, is_default)
         VALUES ($1, $2, 'Visão Geral LeadFlow', NULL, true)`,
        [tenant, workspace],
      );
      // Company with both products: Social wins; blank description → NULL.
      await queryRunner.query(
        `INSERT INTO social_analytics_dashboards
           (tenant_id, workspace_id, agency_client_id, company_context_id, name, description, is_default)
         VALUES ($1, $2, $3, $4, '  Social da empresa  ', '   ', true)`,
        [tenant, workspace, clientBoth, companyBoth],
      );
      await queryRunner.query(
        `INSERT INTO leadflow_analytics_dashboards
           (tenant_id, workspace_id, agency_client_id, company_context_id, name, description, is_default)
         VALUES ($1, $2, $3, $4, 'LeadFlow da empresa', 'ignorada', true)`,
        [tenant, workspace, clientBoth, companyBoth],
      );
      // Company with LeadFlow only: LeadFlow fills it.
      await queryRunner.query(
        `INSERT INTO leadflow_analytics_dashboards
           (tenant_id, workspace_id, agency_client_id, company_context_id, name, description, is_default)
         VALUES ($1, $2, $3, $4, 'Visão Geral', 'Funil do mês', true)`,
        [tenant, workspace, clientLeadflow, companyLeadflow],
      );
      // Legacy shape (client without company) is never seeded.
      await queryRunner.query(
        `INSERT INTO social_analytics_dashboards
           (tenant_id, workspace_id, agency_client_id, company_context_id, name, is_default)
         VALUES ($1, $2, $3, NULL, 'Legado', true)`,
        [tenant, workspace, legacyClient],
      );

      await migration.up(queryRunner);

      const seeded = (await queryRunner.query(
        `SELECT agency_client_id, company_context_id, title, description
           FROM analytics_overview_headers
          WHERE tenant_id = $1 AND workspace_id = $2
          ORDER BY title`,
        [tenant, workspace],
      )) as HeaderRow[];

      expect(seeded).toEqual(
        expect.arrayContaining([
          {
            agency_client_id: null,
            company_context_id: null,
            title: 'Visão Geral',
            description: 'Principais métricas de todos os canais',
          },
          {
            agency_client_id: clientBoth,
            company_context_id: companyBoth,
            title: 'Social da empresa',
            description: null,
          },
          {
            agency_client_id: clientLeadflow,
            company_context_id: companyLeadflow,
            title: 'Visão Geral',
            description: 'Funil do mês',
          },
        ]),
      );
      expect(seeded).toHaveLength(3);

      // Unique per scope — root and company.
      await queryRunner.query('SAVEPOINT dup_root');
      await expect(
        queryRunner.query(
          `INSERT INTO analytics_overview_headers (tenant_id, workspace_id, title)
           VALUES ($1, $2, 'Duplicada')`,
          [tenant, workspace],
        ),
      ).rejects.toThrow(/UQ_analytics_overview_headers_agency/);
      await queryRunner.query('ROLLBACK TO SAVEPOINT dup_root');

      await queryRunner.query('SAVEPOINT dup_company');
      await expect(
        queryRunner.query(
          `INSERT INTO analytics_overview_headers
             (tenant_id, workspace_id, agency_client_id, company_context_id, title)
           VALUES ($1, $2, $3, $4, 'Duplicada')`,
          [tenant, workspace, clientBoth, companyBoth],
        ),
      ).rejects.toThrow(/UQ_analytics_overview_headers_company/);
      await queryRunner.query('ROLLBACK TO SAVEPOINT dup_company');

      // CHECKs: legacy shape and blank title.
      await queryRunner.query('SAVEPOINT ck_scope');
      await expect(
        queryRunner.query(
          `INSERT INTO analytics_overview_headers
             (tenant_id, workspace_id, agency_client_id, title)
           VALUES ($1, $2, $3, 'Legado')`,
          [tenant, workspace, legacyClient],
        ),
      ).rejects.toThrow(/CK_analytics_overview_headers_scope/);
      await queryRunner.query('ROLLBACK TO SAVEPOINT ck_scope');

      await queryRunner.query('SAVEPOINT ck_title');
      await expect(
        queryRunner.query(
          `INSERT INTO analytics_overview_headers
             (tenant_id, workspace_id, agency_client_id, company_context_id, title)
           VALUES ($1, $2, $3, $4, '   ')`,
          [tenant, workspace, randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow(/CK_analytics_overview_headers_title/);
      await queryRunner.query('ROLLBACK TO SAVEPOINT ck_title');

      await migration.down(queryRunner);
      const afterDown = (await queryRunner.query(
        `SELECT to_regclass('public.analytics_overview_headers') AS name`,
      )) as Array<{ name: string | null }>;
      expect(afterDown[0]?.name).toBeNull();

      await migration.up(queryRunner);
      const afterSecondUp = (await queryRunner.query(
        `SELECT count(*)::int AS total FROM analytics_overview_headers
          WHERE tenant_id = $1 AND workspace_id = $2`,
        [tenant, workspace],
      )) as Array<{ total: number }>;
      expect(afterSecondUp[0]?.total).toBe(3);
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });
});
