import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { QueryRunner } from 'typeorm';
import { CreateContractAiAssistRuns1799200000000 } from '../../../database/migrations/1799200000000-create-contract-ai-assist-runs';
import {
  CONTRACT_AI_PRICING_VERSIONS,
  CONTRACT_AI_UNPRICED_COST,
} from './contract-ai-pricing';

it('registers the migration at both agency datasource points and the run in the agency entity registry', () => {
  const datasource = readFileSync(
    resolve(__dirname, '../../../database/agency-typeorm.datasource.ts'),
    'utf8',
  );
  expect(
    datasource.match(/CreateContractAiAssistRuns1799200000000/g),
  ).toHaveLength(2);
  const registry = readFileSync(
    resolve(__dirname, '../../../config/typeorm.config.ts'),
    'utf8',
  );
  expect(registry).toContain('import { ContractAiAssistRun }');
  expect(registry.split('export const agencyEntities = [')[1]).toMatch(
    /^\s*ContractAiAssistRun,/,
  );
});

it('defines a scoped unique key, constrained lifecycle and daily index without storing the input text', async () => {
  const queries: string[] = [];
  const queryRunner = {
    query: (sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    },
  } as unknown as QueryRunner;
  const migration = new CreateContractAiAssistRuns1799200000000();
  await migration.up(queryRunner);
  expect(queries[0]).toContain(
    'UNIQUE ("tenant_id","workspace_id","idempotency_key")',
  );
  expect(queries[0]).toContain(
    "CHECK (\"status\" IN ('processing','succeeded','failed'))",
  );
  expect(queries[0]).toContain('"input_sha256"');
  expect(queries[0]).not.toMatch(/source_text|source_html|input_text/);
  expect(queries[1]).toContain('"tenant_id","workspace_id","created_at"');
  await migration.down(queryRunner);
  expect(queries[2]).toBe(
    'DROP TABLE IF EXISTS "agency_contract_ai_assist_runs"',
  );
});

it('has no price version or fabricated amount until text-model pricing is confirmed', () => {
  expect(CONTRACT_AI_PRICING_VERSIONS).toEqual([]);
  expect(CONTRACT_AI_UNPRICED_COST).toEqual({
    status: 'unknown',
    reason: 'unpriced',
  });
});
