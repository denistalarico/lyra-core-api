import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTRACT_CLIENT_VARIABLE_CATALOG } from './contract-variable-catalog';

it('mirrors every client variable key in the frontend catalogue, excluding team variables', () => {
  const file = resolve(
    __dirname,
    '../../../../../../apps/lyra-agency-web/src/modules/contracts/data/contractTemplateVariables.ts',
  );
  const section = readFileSync(file, 'utf8')
    .split('export const CONTRACT_CLIENT_VARIABLE_GROUPS')[1]
    .split('export const CONTRACT_TEAM_VARIABLE_GROUPS')[0];
  const frontend = [
    ...section.matchAll(/\{\s*key:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"\s*\}/g),
  ].map((match) => match[1]);
  const backend = CONTRACT_CLIENT_VARIABLE_CATALOG.map((item) => item.key);
  expect(frontend.length).toBeGreaterThan(0);
  expect(new Set(backend).size).toBe(backend.length);
  expect([...backend].sort()).toEqual(frontend.sort());
});
