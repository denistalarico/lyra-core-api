import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialGoogleOAuth1803700000000 } from './1803700000000-create-social-google-oauth';
import { SocialGoogleIdentityPerAuthorization1804000000000 } from './1804000000000-social-google-identity-per-authorization';

const run = describePostgresIntegration();

const TABLES = [
  'social_google_authorizations',
  'social_google_oauth_sessions',
  'social_google_product_links',
  'social_google_audit_events',
];

run('social Google OAuth migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up, down, up and enforces its constraints', async () => {
    const migration = new CreateSocialGoogleOAuth1803700000000();
    const runner = AgencyDataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await migration.down(runner);
      await migration.up(runner);
      const exists = async () =>
        (await runner.query(
          `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
          [TABLES],
        )) as Array<{ table_name: string }>;
      expect(await exists()).toHaveLength(4);

      const indexes = (await runner.query(
        `SELECT indexname FROM pg_indexes WHERE tablename LIKE 'social_google_%'`,
      )) as Array<{ indexname: string }>;
      expect(indexes.map((i) => i.indexname)).toEqual(
        expect.arrayContaining([
          'UQ_social_google_authorizations_live_context',
          'UQ_social_google_oauth_sessions_state',
          'UQ_social_google_product_links_authorization_product',
        ]),
      );

      await expect(
        runner.query(
          `INSERT INTO social_google_authorizations (tenant_id, workspace_id, google_sub, status)
           VALUES (gen_random_uuid(), gen_random_uuid(), 's', 'bogus')`,
        ),
      ).rejects.toThrow(/CHK_social_google_authorizations_status/);
    } finally {
      await runner.rollbackTransaction();
    }

    // Rollback leaves the database as it found it; down is idempotent.
    await migration.down(runner);
    expect(
      await runner.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = ANY($1)`,
        [TABLES],
      ),
    ).toHaveLength(0);
    await migration.up(runner);
    await migration.down(runner);
    await migration.up(runner);
    await runner.release();
  });

  it('relaxes the live index to one per identity without touching rows', async () => {
    const base = new CreateSocialGoogleOAuth1803700000000();
    const migration = new SocialGoogleIdentityPerAuthorization1804000000000();
    const runner = AgencyDataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await base.down(runner);
      await base.up(runner);
      const insert = (sub: string) =>
        runner.query(
          `INSERT INTO social_google_authorizations (tenant_id, workspace_id, google_sub)
           VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1',$1)`,
          [sub],
        );
      await insert('a');
      await migration.up(runner);
      await migration.up(runner); // idempotent
      await insert('b'); // a second identity is now allowed
      await runner.query('SAVEPOINT dup');
      await expect(insert('b')).rejects.toThrow(/live_identity/);
      await runner.query('ROLLBACK TO SAVEPOINT dup');
      expect(
        await runner.query(`SELECT 1 FROM social_google_authorizations`),
      ).toHaveLength(2);
      // down cannot restore the stricter index over two identities, and must
      // fail rather than delete anything.
      await runner.query('SAVEPOINT down');
      await expect(migration.down(runner)).rejects.toThrow();
      await runner.query('ROLLBACK TO SAVEPOINT down');
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
