import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';

const run = describePostgresIntegration();

run('AP2 approval supersede advisory lock against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('serializes competing submissions for the same root/company while keeping Company B independent', async () => {
    const first = AgencyDataSource.createQueryRunner();
    const second = AgencyDataSource.createQueryRunner();
    await first.connect();
    await second.connect();
    await first.startTransaction();
    await second.startTransaction();
    const key = 'social-approval:tenant-a:workspace-a:client-a:company-a:planner_content_revision:content-a';
    const companyBKey = 'social-approval:tenant-a:workspace-a:client-a:company-b:planner_content_revision:content-a';
    try {
      await first.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
      const [sameCompany] = await second.query(
        'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [key],
      ) as Array<{ locked: boolean }>;
      const [otherCompany] = await second.query(
        'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [companyBKey],
      ) as Array<{ locked: boolean }>;
      expect(sameCompany.locked).toBe(false);
      expect(otherCompany.locked).toBe(true);
    } finally {
      await first.rollbackTransaction();
      await second.rollbackTransaction();
      await first.release();
      await second.release();
    }
  });
});
