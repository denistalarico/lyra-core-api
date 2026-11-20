import { AddGoogleAdsManualActions1805100000000 } from './1805100000000-add-google-ads-manual-actions';

describe('AddGoogleAdsManualActions1805100000000 migration (GA-WRITE)', () => {
  const run = async (direction: 'up' | 'down') => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      }),
    };
    await new AddGoogleAdsManualActions1805100000000()[direction](
      queryRunner as never,
    );
    return sql.join('\n');
  };

  it('adds allow_keywords off by default', async () => {
    expect(await run('up')).toMatch(
      /ADD COLUMN IF NOT EXISTS "allow_keywords" boolean NOT NULL DEFAULT false/,
    );
  });

  it('widens the action type CHECK keeping the four Meta types', async () => {
    const joined = await run('up');
    expect(
      [
        'set_status',
        'set_budget',
        'set_end_time',
        'delete',
        'negative_keyword',
        'keyword',
        'search_theme',
      ].filter((type) => !joined.includes(`'${type}'`)),
    ).toEqual([]);
  });

  it('is re-runnable', async () => {
    const joined = await run('up');
    expect(joined).toContain('DROP CONSTRAINT IF EXISTS');
    expect(joined.match(/ADD COLUMN (?!IF NOT EXISTS)/g)).toBeNull();
  });

  it('down removes the new rows before narrowing the CHECK', async () => {
    const joined = await run('down');
    expect(joined.indexOf('DELETE FROM')).toBeLessThan(
      joined.indexOf('ADD CONSTRAINT'),
    );
    expect(joined).toContain('DROP COLUMN IF EXISTS "allow_keywords"');
  });
});
