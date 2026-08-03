import { AgencyDataSource } from '../agency-typeorm.datasource';
import { AddLeadflowAgentsLifecycle1788800000000 } from './1788800000000-add-leadflow-agents-lifecycle';

describe('AddLeadflowAgentsLifecycle1788800000000', () => {
  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      AddLeadflowAgentsLifecycle1788800000000,
    );
  });

  it('adds the archive/soft-delete columns and a deleted_at index', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddLeadflowAgentsLifecycle1788800000000();

    await migration.up({ query } as never);

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('ALTER TABLE "leadflow_agents"');
    expect(sql).toContain('ADD COLUMN "archived_at"');
    expect(sql).toContain('ADD COLUMN "deleted_at"');
    expect(sql).toContain('ADD COLUMN "deleted_by_id" uuid');
    expect(sql).toContain('CREATE INDEX "IDX_lf_agents_deleted_at"');
  });

  it('drops the columns and index on down()', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddLeadflowAgentsLifecycle1788800000000();

    await migration.down({ query } as never);

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('DROP INDEX IF EXISTS "IDX_lf_agents_deleted_at"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "deleted_by_id"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "deleted_at"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "archived_at"');
  });
});
