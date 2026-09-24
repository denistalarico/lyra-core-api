import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialApprovals1795100000000 } from './1795100000000-create-social-approvals';
import { AddSocialApprovalViewedAudit1795800000000 } from './1795800000000-add-social-approval-viewed-audit';

const run = describePostgresIntegration();
const viewedColumns = [
  'internal_first_viewed_at',
  'internal_last_viewed_at',
  'internal_viewed_by_user_id',
  'client_first_viewed_at',
  'client_last_viewed_at',
  'client_viewed_by_user_id',
];

run('AP2 viewed-audit migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up/down/up and adds every viewed-audit column without changing approval state', async () => {
    const approvals = new CreateSocialApprovals1795100000000();
    const migration = new AddSocialApprovalViewedAudit1795800000000();
    const runner = AgencyDataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const columns = async () =>
      (await runner.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'social_approval_requests'
            AND column_name = ANY($1::text[])
          ORDER BY column_name`,
        [viewedColumns],
      )) as Array<{ column_name: string }>;
    try {
      await approvals.down(runner);
      await approvals.up(runner);
      await migration.up(runner);
      expect((await columns()).map((column) => column.column_name).sort()).toEqual(
        [...viewedColumns].sort(),
      );

      await migration.down(runner);
      expect(await columns()).toEqual([]);

      await migration.up(runner);
      expect((await columns()).map((column) => column.column_name).sort()).toEqual(
        [...viewedColumns].sort(),
      );
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
