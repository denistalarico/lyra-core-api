import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { AddSocialPublicationMediaAsset1791800000000 } from './1791800000000-add-social-publication-media-asset';

const run = describePostgresIntegration();

run('social publication media asset migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up, inspects the column/FK/index, runs down, then runs up again', async () => {
    const migration = new AddSocialPublicationMediaAsset1791800000000();
    const queryRunner = AgencyDataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // The disposable test database may already have this migration applied.
      await migration.down(queryRunner);

      await migration.up(queryRunner);

      const columns = (await queryRunner.query(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'social_publications'
            AND column_name = 'media_asset_id'`,
      )) as Array<{
        column_name: string;
        data_type: string;
        is_nullable: 'YES' | 'NO';
      }>;

      expect(columns[0]).toMatchObject({
        data_type: 'uuid',
        is_nullable: 'YES',
      });

      const constraints = (await queryRunner.query(
        `SELECT constraint_name
           FROM information_schema.table_constraints
          WHERE table_schema = 'public' AND table_name = 'social_publications'
            AND constraint_name = 'FK_social_publications_media_asset'`,
      )) as Array<{ constraint_name: string }>;
      expect(constraints).toHaveLength(1);

      const fkTarget = (await queryRunner.query(
        `SELECT confrelid::regclass::text AS target, confdeltype
           FROM pg_constraint
          WHERE conname = 'FK_social_publications_media_asset'`,
      )) as Array<{ target: string; confdeltype: string }>;
      expect(fkTarget[0]?.target).toBe('media_assets');
      // 'r' = RESTRICT
      expect(fkTarget[0]?.confdeltype).toBe('r');

      const indexes = (await queryRunner.query(
        `SELECT indexname, indexdef
           FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'social_publications'
            AND indexname = 'IDX_social_publications_media_asset'`,
      )) as Array<{ indexname: string; indexdef: string }>;
      expect(indexes[0]?.indexdef).toContain('(media_asset_id)');

      await migration.down(queryRunner);
      const afterDown = (await queryRunner.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'social_publications'
            AND column_name = 'media_asset_id'`,
      )) as Array<{ column_name: string }>;
      expect(afterDown).toHaveLength(0);

      await migration.up(queryRunner);
      const afterSecondUp = (await queryRunner.query(
        `SELECT column_name
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'social_publications'
            AND column_name = 'media_asset_id'`,
      )) as Array<{ column_name: string }>;
      expect(afterSecondUp).toHaveLength(1);
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });
});
