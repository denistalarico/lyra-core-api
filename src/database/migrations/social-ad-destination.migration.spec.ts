import { getMetadataArgsStorage } from 'typeorm';
import { SocialAdEntity } from '../../modules/social-integrations/entities';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { AddSocialAdDestination1790600000000 } from './1790600000000-add-social-ad-destination';

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
    new AddSocialAdDestination1790600000000().up(queryRunner),
  );

const down = () =>
  collectSql((queryRunner) =>
    new AddSocialAdDestination1790600000000().down(queryRunner),
  );

function columnsOf(target: new () => object) {
  return getMetadataArgsStorage()
    .columns.filter((column) => column.target === target)
    .map((column) => column.options.name ?? column.propertyName);
}

const DESTINATION_COLUMNS = [
  'destination_type',
  'destination_raw',
  'destination_observed_at',
];

describe('social ad destination migration', () => {
  it('adds the three destination columns to the entity table', async () => {
    const joined = await up();

    expect(joined).toContain('ALTER TABLE "social_ad_entities"');
    for (const column of DESTINATION_COLUMNS) {
      expect(joined).toContain(`ADD COLUMN IF NOT EXISTS "${column}"`);
    }
  });

  /**
   * The legacy-data rule, enforced in the SQL itself rather than only in prose.
   *
   * A `DEFAULT` would assert a destination Meta never stated for every row that
   * already exists, and an `UPDATE` would derive one from a name or an
   * optimization goal — the two inferences this whole slice exists to avoid.
   * Old rows must simply stay NULL until a sync observes a real value.
   */
  it('backfills nothing and defaults nothing', async () => {
    const joined = await up();

    expect(joined).not.toMatch(/DEFAULT/i);
    expect(joined).not.toMatch(/\bUPDATE\b/i);
    expect(joined).not.toMatch(/NOT NULL/i);
  });

  /**
   * No index without a plan that uses it. The candidate query groups an
   * account's ad sets — hundreds of rows — and the existing scope index already
   * narrows tenant, workspace and level before the grouping happens.
   */
  it('creates no index', async () => {
    const joined = await up();

    expect(joined).not.toMatch(/CREATE\s+(UNIQUE\s+)?INDEX/i);
  });

  it('does not touch the daily metrics table', async () => {
    const joined = await up();

    // Destination is a dimension of the entity, never a column of a day's
    // numbers.
    expect(joined).not.toContain('social_ad_metrics_daily');
  });

  it('drops exactly what it added', async () => {
    const joined = await down();

    for (const column of DESTINATION_COLUMNS) {
      expect(joined).toContain(`DROP COLUMN IF EXISTS "${column}"`);
    }
    expect(joined).not.toMatch(/DROP TABLE/i);
  });

  it('matches the columns the entity declares', () => {
    const declared = columnsOf(SocialAdEntity);

    for (const column of DESTINATION_COLUMNS) {
      expect(declared).toContain(column);
    }
  });

  /**
   * The registration gotcha: this datasource lists its migrations by hand, so a
   * file that exists but is never added runs nowhere and fails silently at
   * deploy time.
   */
  it('is registered on the agency datasource', () => {
    const registered = (
      AgencyDataSource.options.migrations as Array<new () => object>
    ).map((migration) => migration.name);

    expect(registered).toContain('AddSocialAdDestination1790600000000');
  });
});
