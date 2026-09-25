import { AddAdCreativeId1796800000000 } from './1796800000000-add-ad-creative-id';

/**
 * Fatia C: `social_ad_entities` grows one nullable column and nothing else.
 *
 * Most of what this spec asserts is absence, because the thing most likely to
 * go wrong here is not a malformed `ALTER` — it is somebody later deciding the
 * thumbnail URL may as well be stored beside the id. A URL column appearing on
 * this table would pass every other test in the repository and start returning
 * 403s about five days after deploy, so the prohibition is written down as a
 * test rather than only as a comment.
 */
describe('AddAdCreativeId1796800000000 migration', () => {
  const run = async (direction: 'up' | 'down') => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      }),
    };

    const migration = new AddAdCreativeId1796800000000();

    await migration[direction](queryRunner as never);

    return sql.join('\n');
  };

  it('adds creative_id to the hierarchy mirror', async () => {
    const joined = await run('up');

    expect(joined).toContain('ALTER TABLE "social_ad_entities"');
    expect(joined).toContain('ADD COLUMN IF NOT EXISTS "creative_id"');
  });

  it('stores the id as a provider object id, the width external_id already uses', async () => {
    // A different width would be a second opinion about the same provider's id
    // format, and the narrower of the two would be the one that truncates.
    expect(await run('up')).toContain('varchar(180)');
  });

  it('leaves the column nullable, with no default', async () => {
    const joined = await run('up');

    // NULL is the honest value for an ad synced before this column existed. A
    // default would make "not asked yet" indistinguishable from an answer.
    expect(joined).not.toContain('NOT NULL');
    expect(joined).not.toContain('DEFAULT');
  });

  it('never stores a thumbnail URL', async () => {
    // The rule the whole slice is built around: Meta signs these with an `oe`
    // parameter that expires in about five days. A stored URL renders for a few
    // days and then 403s, long after the commit that caused it.
    const joined = (await run('up')) + (await run('down'));

    expect(joined).not.toMatch(/thumbnail/i);
    expect(joined).not.toMatch(/url/i);
  });

  it('adds no index for a column nothing searches by', async () => {
    // It is read from a row already located by the ad's identity, and this
    // table is written on every sync — an index nothing queries is pure cost.
    expect(await run('up')).not.toContain('CREATE INDEX');
  });

  it('writes no data', async () => {
    const joined = await run('up');

    // The next hierarchy sync fills every row it sees at no extra call cost.
    // Inventing values now would be writing data the provider has not given.
    expect(joined).not.toContain('UPDATE');
    expect(joined).not.toContain('INSERT');
  });

  it('touches only the hierarchy mirror', async () => {
    const joined = (await run('up')) + (await run('down'));
    const tables = [...joined.matchAll(/ALTER TABLE "([^"]+)"/g)].map(
      (match) => match[1],
    );

    expect(new Set(tables)).toEqual(new Set(['social_ad_entities']));
  });

  it('drops the column on the way down', async () => {
    expect(await run('down')).toContain('DROP COLUMN IF EXISTS "creative_id"');
  });
});
