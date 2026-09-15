import { AgencyDataSource } from '../agency-typeorm.datasource';
import { ExpandSocialBoostTemplates1793600000000 } from './1793600000000-expand-social-boost-templates';

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

describe('C6 Boost template expansion migration', () => {
  it('adds explicit goal and conversion fields and preserves old templates', async () => {
    const sql = await collectSql((queryRunner) =>
      new ExpandSocialBoostTemplates1793600000000().up(queryRunner),
    );
    expect(sql).toContain('"performance_goal" varchar(60)');
    expect(sql).toContain('"conversion_location" varchar(40)');
    expect(sql).toContain('UPDATE "social_boost_templates"');
    expect(sql).toContain("'regions', '[]'::jsonb");
    expect(sql).toContain('ALTER COLUMN "performance_goal" SET NOT NULL');
  });

  it('adds relationship-based audience modes', async () => {
    const sql = await collectSql((queryRunner) =>
      new ExpandSocialBoostTemplates1793600000000().up(queryRunner),
    );
    expect(sql).toContain("'followers', 'engagers'");
  });

  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      ExpandSocialBoostTemplates1793600000000,
    );
  });
});
