import { AgencyDataSource } from '../agency-typeorm.datasource';
import { AddSocialOrganicAssetTimezone1792000000000 } from './1792000000000-add-social-organic-asset-timezone';

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

describe('social organic asset timezone migration', () => {
  it('adds a nullable varchar column with no default', async () => {
    const sql = await collectSql((queryRunner) =>
      new AddSocialOrganicAssetTimezone1792000000000().up(queryRunner),
    );

    expect(sql).toContain('ALTER TABLE "social_organic_assets"');
    expect(sql).toContain('ADD COLUMN "asset_timezone" varchar(64)');
    expect(sql).not.toMatch(/asset_timezone[^;]*DEFAULT/i);
    expect(sql).not.toMatch(/asset_timezone[^;]*NOT NULL/i);
  });

  it('removes only the asset timezone column on down', async () => {
    const sql = await collectSql((queryRunner) =>
      new AddSocialOrganicAssetTimezone1792000000000().down(queryRunner),
    );

    expect(sql).toContain('DROP COLUMN "asset_timezone"');
    expect(sql).not.toContain('DROP TABLE');
  });

  it('registers the migration only in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      AddSocialOrganicAssetTimezone1792000000000,
    );
  });
});
