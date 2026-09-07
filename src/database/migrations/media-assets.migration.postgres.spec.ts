import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateMediaAssets1791700000000 } from './1791700000000-create-media-assets';
import { AddSocialPublicationMediaAsset1791800000000 } from './1791800000000-add-social-publication-media-asset';

const run = describePostgresIntegration();

run('media assets migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up, inspects the table and indexes, runs down, then runs up again', async () => {
    const migration = new CreateMediaAssets1791700000000();
    // M3.1B's FK makes social_publications a dependent of media_assets; its
    // own down() must run first or this table's DROP is refused by Postgres.
    const dependent = new AddSocialPublicationMediaAsset1791800000000();
    const queryRunner = AgencyDataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      // The disposable test database may already have all registered migrations.
      await dependent.down(queryRunner);
      await migration.down(queryRunner);

      await migration.up(queryRunner);

      const columns = (await queryRunner.query(
        `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'media_assets'`,
      )) as Array<{
        column_name: string;
        data_type: string;
        is_nullable: 'YES' | 'NO';
        column_default: string | null;
      }>;
      const byName = new Map(
        columns.map((column) => [column.column_name, column]),
      );

      expect(byName.get('tenant_id')).toMatchObject({ is_nullable: 'NO' });
      expect(byName.get('workspace_id')).toMatchObject({ is_nullable: 'NO' });
      expect(byName.get('agency_client_id')).toMatchObject({
        is_nullable: 'YES',
      });
      expect(byName.get('byte_size')?.data_type).toBe('bigint');
      expect(byName.get('duration_ms')?.data_type).toBe('bigint');
      expect(byName.get('metadata')).toMatchObject({
        data_type: 'jsonb',
        is_nullable: 'NO',
      });

      const indexes = (await queryRunner.query(
        `SELECT indexname, indexdef
           FROM pg_indexes
          WHERE schemaname = 'public' AND tablename = 'media_assets'`,
      )) as Array<{ indexname: string; indexdef: string }>;
      const byIndexName = new Map(
        indexes.map((index) => [index.indexname, index.indexdef]),
      );

      expect(byIndexName.get('IDX_media_assets_scope')).toContain(
        '(tenant_id, workspace_id, agency_client_id)',
      );
      expect(byIndexName.get('IDX_media_assets_scope_checksum')).toContain(
        '(tenant_id, workspace_id, agency_client_id, checksum)',
      );
      expect(byIndexName.get('IDX_media_assets_scope_checksum')).toContain(
        'WHERE (checksum IS NOT NULL)',
      );
      expect(byIndexName.get('IDX_media_assets_scope_checksum')).not.toContain(
        'UNIQUE',
      );

      await migration.down(queryRunner);
      const afterDown = (await queryRunner.query(
        `SELECT to_regclass('public.media_assets') AS table_name`,
      )) as Array<{ table_name: string | null }>;
      expect(afterDown[0]?.table_name).toBeNull();

      await migration.up(queryRunner);
      const afterSecondUp = (await queryRunner.query(
        `SELECT to_regclass('public.media_assets') AS table_name`,
      )) as Array<{ table_name: string | null }>;
      expect(afterSecondUp[0]?.table_name).toBe('media_assets');
    } finally {
      await queryRunner.rollbackTransaction();
      await queryRunner.release();
    }
  });
});
