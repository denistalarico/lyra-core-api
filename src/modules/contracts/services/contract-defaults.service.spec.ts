import { Repository } from 'typeorm';
import { ContractDefaults } from '../entities/contract-defaults.entity';
import { ContractDefaultsService } from './contract-defaults.service';
import { CONTRACT_DEFAULT_KEYS } from '../contract-defaults.catalog';
const scope = { tenantId: 'tenant', workspaceId: 'workspace', userId: 'actor' };
function fixture() {
  let row: ContractDefaults | null = null;
  const repo = {
    findOne: jest.fn(() => Promise.resolve(row)),
    create: (value: Partial<ContractDefaults>) =>
      Object.assign(new ContractDefaults(), value),
    save: jest.fn((value: ContractDefaults) => {
      row = value;
      return Promise.resolve(value);
    }),
    manager: {
      transaction: (fn: (m: unknown) => unknown) =>
        Promise.resolve(fn({ query: jest.fn(), getRepository: () => repo })),
    },
  };
  return {
    service: new ContractDefaultsService(
      repo as unknown as Repository<ContractDefaults>,
    ),
    repo,
  };
}
describe('agency contract defaults', () => {
  it('returns version zero and the closed 25-key catalogue when absent', async () =>
    expect(await fixture().service.get(scope)).toMatchObject({
      values: {},
      presets: {},
      version: 0,
      expiringWindowDays: 30,
      allowedKeys: CONTRACT_DEFAULT_KEYS,
    }));
  it('replaces values, removes empty keys and increments version in scoped transaction', async () => {
    const { service, repo } = fixture();
    expect(
      await service.put(scope, {
        targetType: 'client',
        values: { 'contract.city': 'City', 'contract.noticeDays': '' },
        presets: { 'contract.autoRenewal': 'monthly' },
        expectedVersion: 0,
      }),
    ).toMatchObject({ version: 1, values: { 'contract.city': 'City' } });
    expect(
      await service.put(scope, {
        targetType: 'client',
        values: {},
        presets: {},
        expectedVersion: 1,
        expiringWindowDays: 45,
      }),
    ).toMatchObject({ version: 2, values: {}, expiringWindowDays: 45 });
    expect(repo.findOne).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        targetType: 'client',
      },
    });
  });
  it('rejects stale version without saving', async () => {
    const { service, repo } = fixture();
    await expect(
      service.put(scope, {
        targetType: 'client',
        values: {},
        presets: {},
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(repo.save).not.toHaveBeenCalled();
  });
  it.each([
    [
      { values: { 'client.name': 'forbidden' }, presets: {} },
      'contract_default_key_invalid',
    ],
    [
      { values: {}, presets: { 'contract.city': 'x' } },
      'contract_default_key_invalid',
    ],
    [
      { values: {}, presets: { 'contract.autoRenewal': 'bogus' } },
      'contract_default_preset_invalid',
    ],
    [
      { values: { 'contract.city': 'x'.repeat(4001) }, presets: {} },
      'contract_default_value_invalid',
    ],
  ])(
    'rejects invalid entries before mutation',
    async (data, code) =>
      await expect(
        fixture().service.put(scope, { targetType: 'client', ...data }),
      ).rejects.toMatchObject({ status: 422, response: { code } }),
  );
});
