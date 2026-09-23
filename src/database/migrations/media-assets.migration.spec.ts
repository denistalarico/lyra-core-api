import { agencyEntities, getTypeOrmConfig } from '../../config/typeorm.config';
import { MediaAssetEntity } from '../../common/media-assets';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateMediaAssets1791700000000 } from './1791700000000-create-media-assets';

function collectSql(run: (queryRunner: never) => Promise<void>) {
  const sql: string[] = [];
  const queryRunner = {
    query: jest.fn((statement: string) => {
      sql.push(statement);
      return Promise.resolve();
    }),
  };

  return run(queryRunner as never).then(() => sql.join('\n'));
}

describe('media assets migration', () => {
  it('creates every required field with the canonical scope', async () => {
    const sql = await collectSql((queryRunner) =>
      new CreateMediaAssets1791700000000().up(queryRunner),
    );

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "media_assets"');
    for (const definition of [
      '"tenant_id" uuid NOT NULL',
      '"workspace_id" uuid NOT NULL',
      '"agency_client_id" uuid',
      '"storage_path" varchar(512) NOT NULL',
      '"mime_type" varchar(128) NOT NULL',
      '"byte_size" bigint NOT NULL',
      '"original_filename" varchar(255)',
      '"checksum" char(64)',
      '"width" integer',
      '"height" integer',
      '"duration_ms" bigint',
      '"codec" varchar',
      '"source" varchar NOT NULL',
      '"metadata" jsonb NOT NULL DEFAULT \'{}\'::jsonb',
      '"created_by_id" uuid',
      '"created_at" timestamptz NOT NULL DEFAULT now()',
      '"updated_at" timestamptz NOT NULL DEFAULT now()',
      '"deleted_at" timestamptz',
    ]) {
      expect(sql).toContain(definition);
    }
  });

  it('keeps source open and introduces neither a bucket nor a PostgreSQL enum', async () => {
    const sql = await collectSql((queryRunner) =>
      new CreateMediaAssets1791700000000().up(queryRunner),
    );

    expect(sql).not.toMatch(/CREATE\s+TYPE/i);
    expect(sql).not.toMatch(/CHECK\s*\([^)]*"source"/i);
    expect(sql).not.toMatch(/"bucket"/i);
  });

  it('creates scoped, non-unique scope and checksum indexes', async () => {
    const sql = await collectSql((queryRunner) =>
      new CreateMediaAssets1791700000000().up(queryRunner),
    );

    expect(sql).toContain('IDX_media_assets_scope');
    expect(sql).toContain('("tenant_id", "workspace_id", "agency_client_id")');
    expect(sql).toContain('IDX_media_assets_scope_checksum');
    expect(sql).toContain(
      '("tenant_id", "workspace_id", "agency_client_id", "checksum")',
    );
    expect(sql).toContain('WHERE "checksum" IS NOT NULL');
    expect(sql).not.toMatch(/CREATE\s+UNIQUE\s+INDEX[\s\S]*media_assets/i);
  });

  it('drops only the shared media table on rollback', async () => {
    const sql = await collectSql((queryRunner) =>
      new CreateMediaAssets1791700000000().down(queryRunner),
    );

    expect(sql.trim()).toBe('DROP TABLE IF EXISTS "media_assets" CASCADE');
  });
});

describe('media assets schema registration', () => {
  it('registers the migration and entity only in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateMediaAssets1791700000000,
    );
    expect(agencyEntities).toContain(MediaAssetEntity);
    expect(AgencyDataSource.options.entities).toContain(MediaAssetEntity);
    expect(getTypeOrmConfig().entities).not.toContain(MediaAssetEntity);
  });
});
