import { readClientContractTerms } from './contract-term-reader';
import { ContractSignatureProvider, ContractStatus } from './enums';
it('reads all clients in one DISTINCT ON query with tenant/workspace constraints and signed evidence', async () => {
  const row = {
    id: 'signed',
    title: 'Contract',
    status: ContractStatus.Draft,
    signatureProvider: ContractSignatureProvider.None,
    documentKind: 'contract',
    validFrom: '2026-01-01',
    validUntil: null,
    metadata: {},
    variablesData: {},
    signedDocument: true,
    createdAt: new Date(),
    archivedAt: null,
    cancelledAt: null,
  };
  const query = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn<unknown, [string, string]>().mockReturnThis(),
    distinctOn: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawMany: jest
      .fn()
      .mockResolvedValue([{ targetId: 'one', records: [row] }]),
  };
  const createQueryBuilder = jest.fn(() => query),
    findOne = jest.fn().mockResolvedValue({ expiringWindowDays: 45 });
  const terms = await readClientContractTerms(
    { createQueryBuilder } as never,
    { findOne } as never,
    { tenantId: 'tenant', workspaceId: 'workspace' },
    ['one', 'two'],
  );
  expect(terms.get('one')).toMatchObject({
    state: 'open_ended',
    contractId: 'signed',
    windowDays: 45,
  });
  expect(terms.get('two')).toMatchObject({ state: 'none', windowDays: 45 });
  expect(createQueryBuilder).toHaveBeenCalledTimes(1);
  expect(query.distinctOn).toHaveBeenCalledWith(['contract.target_id']);
  expect(query.where).toHaveBeenCalledWith('contract.tenant_id = :tenantId', {
    tenantId: 'tenant',
  });
  expect(query.andWhere).toHaveBeenCalledWith(
    'contract.workspace_id = :workspaceId',
    { workspaceId: 'workspace' },
  );
  expect(query.andWhere).toHaveBeenCalledWith(
    'contract.target_id IN (:...clientIds)',
    { clientIds: ['one', 'two'] },
  );
  expect(query.addSelect.mock.calls[0][0]).toContain(
    'd.tenant_id=contract.tenant_id',
  );
});
