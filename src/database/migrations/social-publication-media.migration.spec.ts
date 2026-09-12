import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialPublicationMedia1792900000000 } from './1792900000000-create-social-publication-media';

function collectSql(run: (queryRunner: never) => Promise<void>) {
  const sql: string[] = [];
  const queryRunner = { query: jest.fn((statement: string) => { sql.push(statement); return Promise.resolve(); }) };
  return run(queryRunner as never).then(() => sql.join('\n'));
}

describe('social publication ordered media migration', () => {
  it('preserves every carousel item with ordered RESTRICT media evidence', async () => {
    const sql = await collectSql((queryRunner) => new CreateSocialPublicationMedia1792900000000().up(queryRunner));
    expect(sql).toContain('CREATE TABLE "social_publication_media"');
    expect(sql).toContain('UNIQUE ("publication_id", "sort_order")');
    expect(sql).toContain('REFERENCES "media_assets"("id") ON DELETE RESTRICT');
    expect(sql).toContain('IDX_social_publication_media_publication');
  });

  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(CreateSocialPublicationMedia1792900000000);
  });
});
