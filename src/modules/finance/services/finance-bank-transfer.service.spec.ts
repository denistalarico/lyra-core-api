import { DataSource, EntityManager, Repository } from 'typeorm';
import { FinanceBankAccount, FinanceBankTransfer } from '../entities';
import { FinanceBankTransferStatus } from '../enums';
import { FinanceBankTransferService } from './finance-bank-transfer.service';
import { FinancePostingService } from './finance-posting.service';

const context = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
};

function makeService(overrides?: { destinationCurrency?: string }) {
  const from = {
    id: 'bank-from',
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    name: 'Conta corrente',
    currency: 'BRL',
    accountId: 'chart-bank',
    active: true,
  } as FinanceBankAccount;
  const to = {
    id: 'bank-to',
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    name: 'Cartão empresarial',
    currency: overrides?.destinationCurrency ?? 'BRL',
    accountId: 'chart-card',
    active: true,
  } as FinanceBankAccount;
  const transferRepo = {
    create: jest.fn((value) => ({ ...value })),
    save: jest.fn(async (value) => ({ id: 'transfer-1', ...value })),
    find: jest.fn(),
  } as unknown as Repository<FinanceBankTransfer>;
  const bankRepo = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
      where.id === from.id ? from : where.id === to.id ? to : null,
    ),
  } as unknown as Repository<FinanceBankAccount>;
  const manager = {
    getRepository: (entity: unknown) =>
      entity === FinanceBankAccount ? bankRepo : transferRepo,
  } as unknown as EntityManager;
  const dataSource = {
    transaction: (callback: (value: EntityManager) => Promise<unknown>) =>
      callback(manager),
  } as DataSource;
  const postingService = {
    postBankTransfer: jest.fn().mockResolvedValue({ id: 'entry-1' }),
    reverseBankTransfer: jest.fn(),
  } as unknown as FinancePostingService;
  const service = new FinanceBankTransferService(
    transferRepo,
    dataSource,
    postingService,
  );

  return { service, transferRepo, postingService };
}

describe('FinanceBankTransferService', () => {
  it('persists and posts a same-currency transfer in one transaction', async () => {
    const { service, transferRepo, postingService } = makeService();

    const transfer = await service.create(context, {
      fromBankAccountId: 'bank-from',
      toBankAccountId: 'bank-to',
      transferDate: '2026-07-31',
      amount: '125.5',
      description: 'Pagamento da fatura',
    });

    expect(transfer).toEqual(
      expect.objectContaining({
        id: 'transfer-1',
        amount: '125.50',
        currency: 'BRL',
        status: FinanceBankTransferStatus.Completed,
      }),
    );
    expect(transferRepo.save).toHaveBeenCalledTimes(1);
    expect(postingService.postBankTransfer).toHaveBeenCalledWith(
      context,
      expect.objectContaining({ id: 'transfer-1' }),
      expect.anything(),
    );
  });

  it('rejects transfers between accounts with different currencies', async () => {
    const { service, transferRepo, postingService } = makeService({
      destinationCurrency: 'USD',
    });

    await expect(
      service.create(context, {
        fromBankAccountId: 'bank-from',
        toBankAccountId: 'bank-to',
        transferDate: '2026-07-31',
        amount: '100.00',
      }),
    ).rejects.toThrow('mesma moeda');
    expect(transferRepo.save).not.toHaveBeenCalled();
    expect(postingService.postBankTransfer).not.toHaveBeenCalled();
  });
});
