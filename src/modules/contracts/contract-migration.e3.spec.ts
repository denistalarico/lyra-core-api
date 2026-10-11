import { QueryRunner } from 'typeorm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AddContractKindsDefaultsAttachments1799400000000 } from '../../database/migrations/1799400000000-add-contract-kinds-defaults-attachments';
it('prepares additive schema/backfill and reversible down without opening a connection', async () => {
  const query = jest.fn().mockResolvedValue(undefined);
  const runner = { query } as unknown as QueryRunner;
  const migration = new AddContractKindsDefaultsAttachments1799400000000();
  await migration.up(runner);
  const up = query.mock.calls.map(([sql]: [string]) => sql).join('\n');
  expect(up).toContain('ON DELETE RESTRICT');
  expect(up).toContain(
    "attachment_kind='contract_pdf' WHERE type='attachment'",
  );
  expect(up).toContain('"values" jsonb');
  expect(up).toContain('UNIQUE (tenant_id, workspace_id, target_type)');
  query.mockClear();
  await migration.down(runner);
  expect(query).toHaveBeenCalledTimes(4);
  // Both registration points matter. Importing a datasource is unnecessary and
  // could pick up production environment configuration, so inspect the source.
  const datasource = readFileSync(
    join(__dirname, '../../database/agency-typeorm.datasource.ts'),
    'utf8',
  );
  expect(
    datasource.match(/AddContractKindsDefaultsAttachments1799400000000/g),
  ).toHaveLength(2);
  const config = readFileSync(
    join(__dirname, '../../config/typeorm.config.ts'),
    'utf8',
  );
  expect(config.split('export const agencyEntities = [')[1]).toContain(
    '  ContractDefaults,',
  );
});
