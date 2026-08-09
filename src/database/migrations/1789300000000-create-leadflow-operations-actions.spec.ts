import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateLeadflowOperationsActions1789300000000 } from './1789300000000-create-leadflow-operations-actions';

describe('CreateLeadflowOperationsActions1789300000000', () => {
  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateLeadflowOperationsActions1789300000000,
    );
  });

  it('creates tenant-scoped actions, confirmation state and append-only events', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new CreateLeadflowOperationsActions1789300000000();

    await migration.up({ query } as never);

    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "leadflow_operations_actions"',
    );
    expect(sql).toContain('"status" varchar(30) NOT NULL');
    expect(sql).toContain('"confirmed_by_id" uuid');
    expect(sql).toContain('"revision" integer NOT NULL DEFAULT 1');
    expect(sql).toContain('"UQ_lf_ops_actions_idempotency"');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "leadflow_operations_action_events"',
    );
  });
});
