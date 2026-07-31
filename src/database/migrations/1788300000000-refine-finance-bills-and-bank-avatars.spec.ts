import { AgencyDataSource } from '../agency-typeorm.datasource';
import { RefineFinanceBillsAndBankAvatars1788300000000 } from './1788300000000-refine-finance-bills-and-bank-avatars';

describe('RefineFinanceBillsAndBankAvatars1788300000000', () => {
  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      RefineFinanceBillsAndBankAvatars1788300000000,
    );
  });

  it('creates partial unique indexes that ignore blank draft numbers', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new RefineFinanceBillsAndBankAvatars1788300000000();

    await migration.up({ query } as never);

    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "avatar_url"');
    expect(sql).toContain('WHERE "bill_number" <> \'\'');
    expect(sql).toContain('WHERE "invoice_number" <> \'\'');
  });
});
