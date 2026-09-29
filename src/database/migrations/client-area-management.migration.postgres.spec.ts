import { randomUUID } from 'crypto';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateClientAreaManagement1797150000000 } from './1797150000000-create-client-area-management';

const run = describePostgresIntegration();

run('CA3 client area management migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up/down/up and constrains agency settings independently from the platform switch', async () => {
    const migration = new CreateClientAreaManagement1797150000000();
    const runner = AgencyDataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const tenant = randomUUID(),
      workspace = randomUUID();
    const reject = async (operation: () => Promise<unknown>) => {
      await runner.query('SAVEPOINT expected_failure');
      await expect(operation()).rejects.toThrow();
      await runner.query('ROLLBACK TO SAVEPOINT expected_failure');
    };
    try {
      await migration.up(runner);
      await migration.down(runner);
      await migration.up(runner);
      await migration.up(runner);
      await runner.query(
        `INSERT INTO client_area_settings (tenant_id,workspace_id,enabled,domain_mode,domain_verification_status) VALUES ($1,$2,false,'default','not_configured')`,
        [tenant, workspace],
      );
      await reject(() =>
        runner.query(
          `INSERT INTO client_area_settings (tenant_id,workspace_id,domain_mode,custom_domain,domain_verification_status) VALUES ($1,$2,'custom',NULL,'pending')`,
          [tenant, randomUUID()],
        ),
      );
      await reject(() =>
        runner.query(
          `INSERT INTO client_area_settings (tenant_id,workspace_id,primary_color) VALUES ($1,$2,'red')`,
          [tenant, randomUUID()],
        ),
      );
      const [row] = (await runner.query(
        `SELECT enabled, branding_mode, default_role, domain_verification_status FROM client_area_settings WHERE tenant_id=$1 AND workspace_id=$2`,
        [tenant, workspace],
      )) as Array<Record<string, unknown>>;
      expect(row).toMatchObject({
        enabled: false,
        branding_mode: 'agency',
        default_role: 'client_viewer',
        domain_verification_status: 'not_configured',
      });
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
