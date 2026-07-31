import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateFinanceBankTransfers1788400000000 } from './1788400000000-create-finance-bank-transfers';

describe('CreateFinanceBankTransfers1788400000000', () => {
  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateFinanceBankTransfers1788400000000,
    );
  });

  it('creates an auditable transfer table with account and amount guards', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new CreateFinanceBankTransfers1788400000000();

    await migration.up({ query } as never);

    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "finance_bank_transfers"',
    );
    expect(sql).toContain('"from_bank_account_id" <> "to_bank_account_id"');
    expect(sql).toContain('CHECK ("amount" > 0)');
    expect(sql).toContain('ON DELETE RESTRICT');
  });
});
