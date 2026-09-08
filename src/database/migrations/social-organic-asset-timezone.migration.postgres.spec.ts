import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { AddSocialOrganicAssetTimezone1792000000000 } from './1792000000000-add-social-organic-asset-timezone';

const run = describePostgresIntegration();

run('social organic asset timezone migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up, inspects nullable/no-default, runs down, then runs up again', async () => {
    const migration = new AddSocialOrganicAssetTimezone1792000000000();
    const queryRunner = AgencyDataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      await queryRunner.query(`
        ALTER TABLE "social_organic_assets"
        DROP COLUMN IF EXISTS "asset_timezone"
      `);
      await migration.up(queryRunner);

      const columns = (await queryRunner.query(
        `SELECT data_type, character_maximum_length, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'social_organic_assets'
            AND column_name = 'asset_timezone'`,
      )) as Array<{
        data_type: string;
        character_maximum_length: number;
        is_nullable: 'YES' | 'NO';
        column_default: string | null;
      }>;

      expect(columns).toEqual([
        {
          data_type: 'character varying',
          character_maximum_length: 64,
          is_nullable: 'YES',
          column_default: null,
        },
      ]);

      const connectionId = '11111111-1111-4111-8111-111111111111';
      await queryRunner.query(
        `INSERT INTO "social_organic_connections" (
           "id", "tenant_id", "workspace_id", "provider",
           "connection_status", "authorization_method"
         ) VALUES ($1, $2, $3, 'a1_1_test', 'connected', 'oauth_business')`,
        [
          connectionId,
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333',
        ],
      );
      const existingStyleRows = (await queryRunner.query(
        `INSERT INTO "social_organic_assets" (
           "tenant_id", "workspace_id", "connection_id", "provider",
           "asset_type", "external_asset_id"
         ) VALUES ($1, $2, $3, 'a1_1_test', 'profile', 'without-timezone')
         RETURNING "asset_timezone"`,
        [
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333',
          connectionId,
        ],
      )) as Array<{ asset_timezone: string | null }>;
      expect(existingStyleRows).toEqual([{ asset_timezone: null }]);

      await migration.down(queryRunner);
      const afterDown = (await queryRunner.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'social_organic_assets'
            AND column_name = 'asset_timezone'`,
      )) as Array<{ column_name: string }>;
      expect(afterDown).toHaveLength(0);

      await migration.up(queryRunner);
      const afterSecondUp = (await queryRunner.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'social_organic_assets'
            AND column_name = 'asset_timezone'`,
      )) as Array<{ column_name: string }>;
      expect(afterSecondUp).toHaveLength(1);
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });
});
