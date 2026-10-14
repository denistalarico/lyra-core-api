import { DataSource } from 'typeorm';
import {
  AgencyClient,
  AgencyClientCompanyContext,
} from '../../clients/entities';
import { ContractDocument, ContractRecord } from '../../contracts/entities';
import {
  ContractDocumentKind,
  ContractSignatureProvider,
  ContractStatus,
  ContractTargetType,
} from '../../contracts/enums';
import { FinanceInvoice } from '../entities';
import { FinanceDocumentRecurrenceService } from './finance-document-recurrence.service';

const scope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  userId: 'actor',
};
const makeContract = (id: string, extra: Partial<ContractRecord> = {}) => ({
  id,
  title: id,
  targetId: 'client-a',
  targetType: ContractTargetType.Client,
  documentKind: ContractDocumentKind.Contract,
  status: ContractStatus.DigitallySigned,
  signatureProvider: ContractSignatureProvider.Autentique,
  validFrom: '2026-01-01',
  validUntil: null,
  metadata: {},
  variablesData: {
    'offer.invoiceDueDay': '15',
    'offer.services': 'Gestão de campanhas',
  },
  createdAt: new Date('2026-01-01'),
  archivedAt: null,
  cancelledAt: null,
  ...extra,
});
function setup({
  customerId = 'contact-a',
  contracts = [makeContract('signed-current')],
  clients = [
    {
      id: 'client-a',
      contactId: 'contact-a',
      status: 'active',
      archivedAt: null,
      metadata: null,
    },
  ],
  contexts = [] as Array<{ agencyClientId: string }>,
} = {}) {
  const repos = new Map<unknown, { find?: jest.Mock; findOne?: jest.Mock }>([
    [
      FinanceInvoice,
      { findOne: jest.fn().mockResolvedValue({ id: 'invoice-a', customerId }) },
    ],
    [AgencyClient, { find: jest.fn().mockResolvedValue(clients) }],
    [
      AgencyClientCompanyContext,
      { find: jest.fn().mockResolvedValue(contexts) },
    ],
    [ContractRecord, { find: jest.fn().mockResolvedValue(contracts) }],
    [ContractDocument, { find: jest.fn().mockResolvedValue([]) }],
  ]);
  const dataSource = {
    getRepository: jest.fn((entity: unknown) => repos.get(entity)),
    transaction: jest.fn(),
  };
  return {
    service: new FinanceDocumentRecurrenceService(
      dataSource as unknown as DataSource,
    ),
    repos,
    dataSource,
  };
}
describe('Finance active contract linkage', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-14T15:00:00Z'));
  });
  afterAll(() => jest.useRealTimers());
  it('offers only the current signed contract, preserving it beside a pending renewal', async () => {
    const { service, repos } = setup({
      contracts: [
        makeContract('signed-current'),
        makeContract('pending-renewal', {
          status: ContractStatus.Draft,
          createdAt: new Date('2026-10-01'),
        }),
        makeContract('signed-future', { validFrom: '2026-11-01' }),
        makeContract('expired', { validUntil: '2026-10-01' }),
      ],
    });
    const result = await service.eligibleContracts(scope, 'invoice-a');
    expect(result).toEqual([
      expect.objectContaining({
        id: 'signed-current',
        dueDay: 15,
        services: 'Gestão de campanhas',
      }),
    ]);
    expect(repos.get(ContractRecord)?.find).toHaveBeenCalledWith({
      where: [
        expect.objectContaining({
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          targetId: 'client-a',
          targetType: 'client',
          documentKind: 'contract',
        }),
      ],
    });
  });
  it('does not infer ownership from matching display names', async () => {
    const { service, repos } = setup({ customerId: 'other-contact' });
    expect(await service.eligibleContracts(scope, 'invoice-a')).toEqual([]);
    expect(repos.get(ContractRecord)?.find).not.toHaveBeenCalled();
  });
  it('accepts the active company context of the same scoped client', async () => {
    const { service } = setup({
      customerId: 'company-a',
      contexts: [{ agencyClientId: 'client-a' }],
    });
    expect(await service.eligibleContracts(scope, 'invoice-a')).toHaveLength(1);
  });
  it('rejects a cross-client or unsigned contract before any write', async () => {
    const { service, dataSource } = setup();
    await expect(
      service.configure(scope, 'invoice', 'invoice-a', {
        enabled: true,
        generationDay: 1,
        dueDay: 10,
        competenceMode: 'current',
        contractId: 'other-contract',
      }),
    ).rejects.toThrow('vigente');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
  it('excludes a contract whose termination is effective today', async () => {
    const { service } = setup({
      contracts: [
        makeContract('terminated', {
          metadata: { termination: { effectiveDate: '2026-10-14' } },
        }),
      ],
    });
    expect(await service.eligibleContracts(scope, 'invoice-a')).toEqual([]);
  });
});
