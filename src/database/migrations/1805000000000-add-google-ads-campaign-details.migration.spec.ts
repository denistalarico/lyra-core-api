import { AddGoogleAdsCampaignDetails1805000000000 } from './1805000000000-add-google-ads-campaign-details';

describe('AddGoogleAdsCampaignDetails1805000000000 migration (GA-DET)', () => {
  const run = async (direction: 'up' | 'down') => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      }),
    };
    await new AddGoogleAdsCampaignDetails1805000000000()[direction](
      queryRunner as never,
    );
    return sql.join('\n');
  };

  it('widens the breakdown CHECK keeping the four Meta dimensions', async () => {
    const joined = await run('up');
    expect(
      [
        'age_gender',
        'device_platform',
        'publisher_platform',
        'hourly',
        'ad_network',
        'conversion_action',
      ].filter((kind) => !joined.includes(`'${kind}'`)),
    ).toEqual([]);
  });

  it('adds the conversion columns as nullable (NULL is not zero)', async () => {
    expect(await run('up')).toMatch(
      /ADD COLUMN IF NOT EXISTS "conversions" numeric\(18,6\) NULL/,
    );
  });

  it('keys search terms by hash, not by the 512-character text', async () => {
    expect(await run('up')).toMatch(
      /"UQ_social_ad_search_terms_daily_fact"[\s\S]*"term_kind", "term_hash"/,
    );
  });

  it('is re-runnable', async () => {
    const joined = await run('up');
    expect(
      joined.match(/CREATE (UNIQUE )?(TABLE|INDEX) (?!IF NOT EXISTS)/g),
    ).toBeNull();
  });

  it('removes the Google rows before narrowing the CHECK back', async () => {
    const joined = await run('down');
    expect(joined.indexOf('DELETE FROM')).toBeLessThan(
      joined.indexOf('ADD CONSTRAINT'),
    );
  });
});
