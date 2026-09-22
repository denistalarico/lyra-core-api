import { AgencyDataSource } from '../agency-typeorm.datasource';
import { AddSocialOrganicPostLifetimeSnapshots1792400000000 } from './1792400000000-add-social-organic-post-lifetime-snapshots';

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

const up = () =>
  collectSql((queryRunner) =>
    new AddSocialOrganicPostLifetimeSnapshots1792400000000().up(queryRunner),
  );
const down = () =>
  collectSql((queryRunner) =>
    new AddSocialOrganicPostLifetimeSnapshots1792400000000().down(queryRunner),
  );

describe('add social organic post lifetime snapshots migration', () => {
  it('adds the 4 lifetime columns paired with their own observed-at instant, all nullable', async () => {
    const joined = await up();

    for (const column of [
      'impressions_lifetime',
      'likes_lifetime',
      'comments_lifetime',
      'video_views_lifetime',
    ]) {
      // `IF NOT EXISTS` so the migration can re-run against an already
      // migrated database, which the PostgreSQL integration specs do.
      expect(joined).toContain(`ADD COLUMN IF NOT EXISTS "${column}" bigint`);
      expect(joined).toContain(
        `ADD COLUMN IF NOT EXISTS "${column}_observed_at" timestamptz`,
      );
    }
  });

  it('never adds a NOT NULL or DEFAULT to a new column (additive, nullable-only)', async () => {
    const joined = await up();

    // Anchored on the column name rather than on `ADD COLUMN` so the guard
    // survives the `IF NOT EXISTS` between them.
    expect(joined).not.toMatch(/"impressions_lifetime" bigint[^,]*NOT NULL/);
    expect(joined).not.toMatch(/"impressions_lifetime" bigint[^,]*DEFAULT/);
  });

  it('drops and re-adds the non-negative CHECK widened to the 4 new columns', async () => {
    const joined = await up();

    expect(joined).toContain(
      'DROP CONSTRAINT IF EXISTS "CK_social_organic_post_metrics_daily_non_negative"',
    );
    const addIndex = joined.indexOf(
      'ADD CONSTRAINT "CK_social_organic_post_metrics_daily_non_negative"',
    );
    expect(addIndex).toBeGreaterThan(-1);
    const addStatement = joined.slice(addIndex);
    for (const column of [
      'impressions_lifetime',
      'likes_lifetime',
      'comments_lifetime',
      'video_views_lifetime',
    ]) {
      expect(addStatement).toContain(`"${column}" >= 0`);
    }
    // The original 10 flow counters are still covered by the same constraint.
    expect(addStatement).toContain('"impressions" >= 0');
    expect(addStatement).toContain('"profile_visits" >= 0');
  });

  it('drops the constraint before adding columns, and columns come before the ALTER-table statements needing them', async () => {
    const joined = await up();
    const addColumns = joined.indexOf(
      'ADD COLUMN IF NOT EXISTS "impressions_lifetime"',
    );
    const dropConstraint = joined.indexOf(
      'DROP CONSTRAINT IF EXISTS "CK_social_organic_post_metrics_daily_non_negative"',
    );

    expect(addColumns).toBeGreaterThan(-1);
    expect(dropConstraint).toBeGreaterThan(addColumns);
  });

  it('down() restores the original constraint before dropping the new columns', async () => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      }),
    };
    await new AddSocialOrganicPostLifetimeSnapshots1792400000000().down(
      queryRunner as never,
    );

    const restoreStatementIndex = sql.findIndex((statement) =>
      statement.includes(
        'ADD CONSTRAINT "CK_social_organic_post_metrics_daily_non_negative"',
      ),
    );
    const dropColumnStatementIndex = sql.findIndex((statement) =>
      statement.includes('DROP COLUMN "impressions_lifetime"'),
    );

    expect(restoreStatementIndex).toBeGreaterThan(-1);
    expect(dropColumnStatementIndex).toBeGreaterThan(-1);
    expect(restoreStatementIndex).toBeLessThan(dropColumnStatementIndex);
    // The restored CHECK is exactly the original 10-counter expression, with
    // no lifetime column mentioned in that one statement.
    expect(sql[restoreStatementIndex]).not.toContain('impressions_lifetime');
  });

  it('down() cleanly drops all 8 new columns', async () => {
    const joined = await down();

    for (const column of [
      'impressions_lifetime',
      'impressions_lifetime_observed_at',
      'likes_lifetime',
      'likes_lifetime_observed_at',
      'comments_lifetime',
      'comments_lifetime_observed_at',
      'video_views_lifetime',
      'video_views_lifetime_observed_at',
    ]) {
      expect(joined).toContain(`DROP COLUMN "${column}"`);
    }
  });

  it('touches only social_organic_post_metrics_daily', async () => {
    const joined = `${await up()}\n${await down()}`;

    expect(joined).not.toContain('social_organic_account_metrics_daily');
    expect(joined).not.toContain('social_ad_metrics_daily');
  });
});

describe('add social organic post lifetime snapshots registration', () => {
  it('registers the migration in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      AddSocialOrganicPostLifetimeSnapshots1792400000000,
    );
  });
});
