import { AgencyDataSource } from '../agency-typeorm.datasource';
import { AddSocialPublicationMediaAsset1791800000000 } from './1791800000000-add-social-publication-media-asset';

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

describe('social publication media asset migration', () => {
  it('adds a nullable media_asset_id column', async () => {
    const sql = await collectSql((queryRunner) =>
      new AddSocialPublicationMediaAsset1791800000000().up(queryRunner),
    );

    expect(sql).toContain(
      'ALTER TABLE "social_publications"\n        ADD COLUMN IF NOT EXISTS "media_asset_id" uuid',
    );
  });

  it('adds a RESTRICT foreign key to media_assets', async () => {
    const sql = await collectSql((queryRunner) =>
      new AddSocialPublicationMediaAsset1791800000000().up(queryRunner),
    );

    expect(sql).toContain('FK_social_publications_media_asset');
    expect(sql).toContain('REFERENCES "media_assets" ("id")');
    expect(sql).toContain('ON DELETE RESTRICT');
  });

  it('indexes the new column', async () => {
    const sql = await collectSql((queryRunner) =>
      new AddSocialPublicationMediaAsset1791800000000().up(queryRunner),
    );

    expect(sql).toContain('IDX_social_publications_media_asset');
    expect(sql).toContain('ON "social_publications" ("media_asset_id")');
  });

  it('leaves asset_id (destination) untouched', async () => {
    const sql = await collectSql((queryRunner) =>
      new AddSocialPublicationMediaAsset1791800000000().up(queryRunner),
    );

    expect(sql).not.toContain('"asset_id"');
    expect(sql).not.toContain('FK_social_publications_asset"');
  });

  it('reverses column, constraint and index on the way down', async () => {
    const sql = await collectSql((queryRunner) =>
      new AddSocialPublicationMediaAsset1791800000000().down(queryRunner),
    );

    expect(sql).toContain(
      'DROP INDEX IF EXISTS "IDX_social_publications_media_asset"',
    );
    expect(sql).toContain(
      'DROP CONSTRAINT IF EXISTS "FK_social_publications_media_asset"',
    );
    expect(sql).toContain('DROP COLUMN IF EXISTS "media_asset_id"');
  });
});

describe('social publication media asset migration registration', () => {
  it('registers the migration in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      AddSocialPublicationMediaAsset1791800000000,
    );
  });
});
