import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialCreativeStudio1794100000000 } from './1794100000000-create-social-creative-studio';

const run = describePostgresIntegration();

run('Creative Studio migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up/down/up and verifies constraints, indexes and the current-version cycle', async () => {
    const migration = new CreateSocialCreativeStudio1794100000000();
    const queryRunner = AgencyDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await migration.down(queryRunner);
      await migration.up(queryRunner);

      const constraints = (await queryRunner.query(
        `SELECT conname, contype, conrelid::regclass::text AS table_name,
                confrelid::regclass::text AS referenced_table
           FROM pg_constraint
          WHERE conrelid IN ('social_creative_folders'::regclass,
                             'social_creative_assets'::regclass,
                             'social_creative_asset_versions'::regclass)
          ORDER BY conname`,
      )) as Array<{
        conname: string;
        contype: string;
        table_name: string;
        referenced_table: string;
      }>;
      const byConstraint = new Map(
        constraints.map((constraint) => [constraint.conname, constraint]),
      );

      expect(
        byConstraint.get('FK_social_creative_assets_current_version'),
      ).toMatchObject({
        contype: 'f',
        table_name: 'social_creative_assets',
        referenced_table: 'social_creative_asset_versions',
      });
      expect(
        byConstraint.get('FK_social_creative_asset_versions_asset'),
      ).toMatchObject({
        contype: 'f',
        table_name: 'social_creative_asset_versions',
        referenced_table: 'social_creative_assets',
      });
      expect(
        byConstraint.get('FK_social_creative_asset_versions_media')
          ?.referenced_table,
      ).toBe('media_assets');
      expect(
        byConstraint.get('FK_social_creative_asset_versions_thumbnail')
          ?.referenced_table,
      ).toBe('media_assets');
      expect(
        byConstraint.get('FK_social_creative_assets_folder')?.referenced_table,
      ).toBe('social_creative_folders');
      expect(
        byConstraint.get('FK_social_creative_folders_parent')?.referenced_table,
      ).toBe('social_creative_folders');
      expect(
        byConstraint.get('UQ_social_creative_asset_versions_number')?.contype,
      ).toBe('u');
      expect(byConstraint.get('CK_social_creative_assets_type')?.contype).toBe(
        'c',
      );
      expect(
        byConstraint.get('CK_social_creative_assets_status')?.contype,
      ).toBe('c');
      expect(
        byConstraint.get('CK_social_creative_asset_versions_number')?.contype,
      ).toBe('c');
      expect(
        byConstraint.get('CK_social_creative_asset_versions_source')?.contype,
      ).toBe('c');

      const indexes = (await queryRunner.query(
        `SELECT indexname, indexdef
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename IN ('social_creative_folders', 'social_creative_assets',
                              'social_creative_asset_versions')`,
      )) as Array<{ indexname: string; indexdef: string }>;
      const byIndex = new Map(
        indexes.map((index) => [index.indexname, index.indexdef]),
      );
      expect(byIndex.get('IDX_social_creative_folders_scope')).toContain(
        '(tenant_id, workspace_id, agency_client_id)',
      );
      expect(byIndex.get('IDX_social_creative_assets_scope_created')).toContain(
        '(tenant_id, workspace_id, agency_client_id, created_at DESC)',
      );
      expect(byIndex.get('IDX_social_creative_asset_versions_asset')).toContain(
        '(creative_asset_id, version_number DESC)',
      );
      expect(byIndex.get('UQ_social_creative_asset_versions_number')).toContain(
        'UNIQUE',
      );

      await migration.down(queryRunner);
      const afterDown = (await queryRunner.query(
        `SELECT to_regclass('public.social_creative_assets') AS assets,
                to_regclass('public.social_creative_asset_versions') AS versions,
                to_regclass('public.social_creative_folders') AS folders`,
      )) as Array<{
        assets: string | null;
        versions: string | null;
        folders: string | null;
      }>;
      expect(afterDown[0]).toEqual({
        assets: null,
        versions: null,
        folders: null,
      });

      await migration.up(queryRunner);
      const afterSecondUp = (await queryRunner.query(
        `SELECT to_regclass('public.social_creative_assets') AS table_name`,
      )) as Array<{ table_name: string | null }>;
      expect(afterSecondUp[0]?.table_name).toBe('social_creative_assets');
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });
});
