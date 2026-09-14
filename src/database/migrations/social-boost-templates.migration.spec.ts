import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateSocialBoostTemplates1793200000000 } from './1793200000000-create-social-boost-templates';

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

describe('social Boost templates migration', () => {
  it('creates a context-scoped and provider-ready template table', async () => {
    const sql = await collectSql((queryRunner) =>
      new CreateSocialBoostTemplates1793200000000().up(queryRunner),
    );

    expect(sql).toContain('"social_boost_templates"');
    expect(sql).toContain('"tenant_id" uuid NOT NULL');
    expect(sql).toContain('"workspace_id" uuid NOT NULL');
    expect(sql).toContain("'meta', 'google', 'tiktok'");
    expect(sql).toContain('"budget_amount_minor" bigint NOT NULL');
  });

  it('allows only one default per provider and exact context', async () => {
    const sql = await collectSql((queryRunner) =>
      new CreateSocialBoostTemplates1793200000000().up(queryRunner),
    );

    expect(sql).toContain('UQ_social_boost_templates_agency_default');
    expect(sql).toContain('UQ_social_boost_templates_client_default');
    expect(sql).toContain('WHERE "agency_client_id" IS NULL AND "is_default" = true');
    expect(sql).toContain('WHERE "agency_client_id" IS NOT NULL AND "is_default" = true');
  });

  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateSocialBoostTemplates1793200000000,
    );
  });
});
