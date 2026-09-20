import { CreateSocialCreativeStudio1794100000000 } from './1794100000000-create-social-creative-studio';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeFolderEntity,
} from '../../modules/social-creative-studio/entities';
import { agencyEntities } from '../../config/typeorm.config';

function collectSql(run: (queryRunner: never) => Promise<void>) {
  const sql: string[] = [];
  const runner = {
    query: jest.fn((statement: string) => {
      sql.push(statement);
      return Promise.resolve();
    }),
  };
  return run(runner as never).then(() => sql.join('\n'));
}

describe('social creative studio migration', () => {
  it('creates only logical asset tables and keeps the current-version cycle safe', async () => {
    const sql = await collectSql((runner) =>
      new CreateSocialCreativeStudio1794100000000().up(runner),
    );
    for (const table of [
      'social_creative_folders',
      'social_creative_assets',
      'social_creative_asset_versions',
    ])
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    expect(sql).toContain('"thumbnail_media_asset_id" uuid');
    expect(sql).toContain('FK_social_creative_assets_current_version');
    expect(sql).toContain('REFERENCES "media_assets" ("id")');
    expect(sql).not.toContain('storage_path');
    expect(sql).not.toContain('managed_tenant_id');
  });
  it('drops the current-version cycle before dropping the version table', async () => {
    const sql = await collectSql((runner) =>
      new CreateSocialCreativeStudio1794100000000().down(runner),
    );
    expect(
      sql.indexOf(
        'DROP CONSTRAINT IF EXISTS "FK_social_creative_assets_current_version"',
      ),
    ).toBeGreaterThanOrEqual(0);
    expect(
      sql.indexOf(
        'DROP CONSTRAINT IF EXISTS "FK_social_creative_assets_current_version"',
      ),
    ).toBeLessThan(
      sql.indexOf('DROP TABLE IF EXISTS "social_creative_asset_versions"'),
    );
  });
  it('registers entities and migration solely on the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateSocialCreativeStudio1794100000000,
    );
    for (const entity of [
      CreativeAssetEntity,
      CreativeAssetVersionEntity,
      CreativeFolderEntity,
    ]) {
      expect(agencyEntities).toContain(entity);
      expect(AgencyDataSource.options.entities).toContain(entity);
    }
  });
});
