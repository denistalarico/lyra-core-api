import { AddGoogleAdsConversionUploads1805200000000 } from './1805200000000-add-google-ads-conversion-uploads';

describe('AddGoogleAdsConversionUploads1805200000000 migration (GA-CONV)', () => {
  const run = async (direction: 'up' | 'down') => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      }),
    };
    await new AddGoogleAdsConversionUploads1805200000000()[direction](
      queryRunner as never,
    );
    return sql.join('\n');
  };

  it('creates the settings off by default, one per connection', async () => {
    const joined = await run('up');
    expect(joined).toMatch(/"enabled" boolean NOT NULL DEFAULT false/);
    expect(joined).toContain(
      'UQ_google_ads_conversion_upload_settings_connection" UNIQUE ("connection_id")',
    );
  });

  it('makes the transaction id unique per connection (D-G6 idempotency)', async () => {
    expect(await run('up')).toContain(
      'UNIQUE ("connection_id", "transaction_id")',
    );
  });

  it('keeps lead PII columns out of the upload table', async () => {
    expect(await run('up')).not.toMatch(/"(email|phone|name|full_name)"/);
  });

  it('is re-runnable', async () => {
    const joined = await run('up');
    expect(joined.match(/CREATE TABLE (?!IF NOT EXISTS)/g)).toBeNull();
    expect(joined.match(/CREATE INDEX (?!IF NOT EXISTS)/g)).toBeNull();
  });

  it('down drops the uploads before the settings', async () => {
    const joined = await run('down');
    expect(joined.indexOf('"google_ads_conversion_uploads"')).toBeLessThan(
      joined.indexOf('"google_ads_conversion_upload_settings"'),
    );
  });
});
