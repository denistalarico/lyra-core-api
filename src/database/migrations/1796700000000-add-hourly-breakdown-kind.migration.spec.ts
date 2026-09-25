import { AddHourlyBreakdownKind1796700000000 } from './1796700000000-add-hourly-breakdown-kind';

/**
 * Fatia B: `breakdown_kind` grows a fourth value and nothing else.
 *
 * The migration is narrow on purpose — the hourly dimension reuses the row
 * shape, the unique key and the read index that already exist — so the spec
 * asserts that narrowness directly. A column, an index or a backfill appearing
 * here later would mean the dimension had stopped being a dimension of this
 * table, which is a design change worth failing a test over.
 */
describe('AddHourlyBreakdownKind1796700000000 migration', () => {
  const run = async (direction: 'up' | 'down') => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      }),
    };

    const migration = new AddHourlyBreakdownKind1796700000000();

    await migration[direction](queryRunner as never);

    return sql.join('\n');
  };

  it('widens the CHECK to admit hourly alongside the original three', async () => {
    const joined = await run('up');

    for (const kind of [
      'age_gender',
      'device_platform',
      'publisher_platform',
      'hourly',
    ]) {
      expect(joined).toContain(`'${kind}'`);
    }
  });

  it('drops the old constraint before adding the new one', async () => {
    const joined = await run('up');

    expect(joined.indexOf('DROP CONSTRAINT')).toBeLessThan(
      joined.indexOf('ADD CONSTRAINT'),
    );
    expect(joined).toContain('"CK_social_ad_breakdown_daily_kind"');
  });

  it('adds no column, no index and no backfill', async () => {
    // The hourly dimension occupies the row shape that already exists. Anything
    // more here would mean it had outgrown this table.
    const joined = await run('up');

    expect(joined).not.toMatch(/ADD COLUMN/i);
    expect(joined).not.toMatch(/CREATE (UNIQUE )?INDEX/i);
    expect(joined).not.toMatch(/\bUPDATE\b/i);
  });

  it('touches only the breakdown table', async () => {
    const joined = await run('up');

    expect(joined).toContain('"social_ad_breakdown_daily"');
    expect(joined).not.toContain('social_ad_metrics_daily');
    expect(joined).not.toContain('social_organic_audience_daily');
  });

  it('narrows the CHECK back on the way down', async () => {
    const joined = await run('down');

    expect(joined).toContain(
      `CHECK ("breakdown_kind" IN (\n          'age_gender',\n          'device_platform',\n          'publisher_platform'\n        ))`,
    );
  });

  it('clears the hourly rows before restoring the narrower constraint', async () => {
    // `ADD CONSTRAINT` fails against rows that violate it, so a down() that
    // only restored the constraint could not run on any database where the
    // dimension had actually been ingested.
    const joined = await run('down');

    expect(joined).toContain(
      `DELETE FROM "social_ad_breakdown_daily" WHERE "breakdown_kind" = 'hourly'`,
    );
    expect(joined.indexOf('DELETE FROM')).toBeLessThan(
      joined.indexOf('ADD CONSTRAINT'),
    );
  });

  it('deletes only the hourly rows, never another dimension', async () => {
    const joined = await run('down');

    expect(joined).not.toMatch(/DELETE FROM "social_ad_breakdown_daily"\s*$/m);
    for (const kind of ['age_gender', 'device_platform']) {
      expect(joined).not.toContain(`"breakdown_kind" = '${kind}'`);
    }
  });
});
