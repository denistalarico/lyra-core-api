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
    findOne: jest.fn(),
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

describe('Finance transfer visibility', () => {
  it('archives without changing the movement or its accounting', async () => {
    const { service, transferRepo, postingService } = makeService();
    jest.mocked(transferRepo).findOne.mockResolvedValue({
      id: 'transfer-1',
      status: FinanceBankTransferStatus.Completed,
      metadata: { reference: 'kept' },
    } as unknown as FinanceBankTransfer);
    const result = await service.archive(context, 'transfer-1');
    expect(result.status).toBe(FinanceBankTransferStatus.Completed);
    expect(result.metadata.reference).toBe('kept');
    expect(typeof result.metadata.archivedAt).toBe('string');
    expect(
      jest.mocked(postingService).reverseBankTransfer.mock.calls,
    ).toHaveLength(0);
    expect(jest.mocked(transferRepo).findOne.mock.calls[0][0]).toEqual({
      where: {
        id: 'transfer-1',
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
      lock: { mode: 'pessimistic_write' },
    });
  });
  it('reverses a completed transfer before logical deletion and remains idempotent', async () => {
    const { service, transferRepo, postingService } = makeService();
    const transfer = {
      id: 'transfer-1',
      status: FinanceBankTransferStatus.Completed,
      metadata: {},
    } as FinanceBankTransfer;
    jest.mocked(transferRepo).findOne.mockResolvedValue(transfer);
    await service.delete(context, 'transfer-1');
    await service.delete(context, 'transfer-1');
    expect(
      jest.mocked(postingService).reverseBankTransfer.mock.calls,
    ).toHaveLength(1);
    expect(transfer.status).toBe(FinanceBankTransferStatus.Reversed);
    expect(transfer.metadata.deletedAt).toEqual(expect.any(String));
  });
  it('does not hide the transfer when accounting reversal fails', async () => {
    const { service, transferRepo, postingService } = makeService();
    const transfer = {
      id: 'transfer-1',
      status: FinanceBankTransferStatus.Completed,
      metadata: {},
    } as FinanceBankTransfer;
    jest.mocked(transferRepo).findOne.mockResolvedValue(transfer);
    jest
      .mocked(postingService)
      .reverseBankTransfer.mockRejectedValue(new Error('posting failed'));
    await expect(service.delete(context, 'transfer-1')).rejects.toThrow(
      'posting failed',
    );
    expect(jest.mocked(transferRepo).save.mock.calls).toHaveLength(0);
    expect(transfer.metadata.deletedAt).toBeUndefined();
  });
  it('rejects a transfer outside the scoped repository lookup', async () => {
    const { service, transferRepo } = makeService();
    jest.mocked(transferRepo).findOne.mockResolvedValue(null);
    await expect(service.archive(context, 'other')).rejects.toThrow(
      'não encontrada',
    );
    expect(jest.mocked(transferRepo).save.mock.calls).toHaveLength(0);
  });
});
