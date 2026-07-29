import { Repository } from 'typeorm';
import {
  FinanceBill,
  FinancePayment,
  FinancePaymentAllocation,
} from '../entities';
import {
  FinanceAllocationTargetType,
  FinanceBillStatus,
  FinancePaymentDirection,
  FinancePaymentMethod,
  FinancePaymentStatus,
} from '../enums';
import { TeamPayment } from '../../team/entities';
import { TeamPaymentStatus } from '../../team/enums';
import { FinanceTeamPaymentReconciliationService } from './finance-team-payment-reconciliation.service';

const CTX = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
};

function makeTeamPayment(overrides: Partial<TeamPayment> = {}): TeamPayment {
  return {
    id: 'team-payment-1',
    tenantId: CTX.tenantId,
    workspaceId: CTX.workspaceId,
    financeBillId: 'bill-1',
    financePaymentId: null,
    status: TeamPaymentStatus.PaymentPending,
    paidAt: null,
    metadata: {},
    ...overrides,
  } as TeamPayment;
}

function makeBill(overrides: Partial<FinanceBill> = {}): FinanceBill {
  return {
    id: 'bill-1',
    tenantId: CTX.tenantId,
    workspaceId: CTX.workspaceId,
    status: FinanceBillStatus.Open,
    totalAmount: '100.00',
    paidAmount: '0.00',
    balanceDue: '100.00',
    paidAt: null,
    ...overrides,
  } as FinanceBill;
}

function makeFinancePayment(
  overrides: Partial<FinancePayment> = {},
): FinancePayment {
  return {
    id: 'finance-payment-1',
    tenantId: CTX.tenantId,
    workspaceId: CTX.workspaceId,
    direction: FinancePaymentDirection.Vendor,
    status: FinancePaymentStatus.Completed,
    method: FinancePaymentMethod.Manual,
    paymentDate: '2026-07-15',
    amount: '100.00',
    allocatedAmount: '100.00',
    currency: 'BRL',
    metadata: {},
    createdAt: new Date('2026-07-15T12:00:00.000Z'),
    ...overrides,
  } as FinancePayment;
}

function makeAllocation(
  overrides: Partial<FinancePaymentAllocation> = {},
): FinancePaymentAllocation {
  return {
    id: 'allocation-1',
    tenantId: CTX.tenantId,
    workspaceId: CTX.workspaceId,
    paymentId: 'finance-payment-1',
    targetType: FinanceAllocationTargetType.Bill,
    targetId: 'bill-1',
    amount: '100.00',
    metadata: {},
    createdAt: new Date('2026-07-15T12:00:00.000Z'),
    ...overrides,
  };
}

function makeService(options: {
  teamPayments?: TeamPayment[];
  bills?: FinanceBill[];
  allocations?: FinancePaymentAllocation[];
  financePayments?: FinancePayment[];
}) {
  const teamPaymentsRepository = {
    find: jest.fn((findOptions?: unknown) => {
      void findOptions;
      return Promise.resolve(options.teamPayments ?? []);
    }),
    save: jest.fn((items: TeamPayment[]) => Promise.resolve(items)),
  };
  const billsRepository = {
    find: jest.fn(() => Promise.resolve(options.bills ?? [])),
  };
  const allocationsRepository = {
    find: jest.fn(() => Promise.resolve(options.allocations ?? [])),
  };
  const financePaymentsRepository = {
    find: jest.fn(() => Promise.resolve(options.financePayments ?? [])),
  };

  const service = new FinanceTeamPaymentReconciliationService(
    teamPaymentsRepository as unknown as Repository<TeamPayment>,
    billsRepository as unknown as Repository<FinanceBill>,
    allocationsRepository as unknown as Repository<FinancePaymentAllocation>,
    financePaymentsRepository as unknown as Repository<FinancePayment>,
  );

  return {
    service,
    teamPaymentsRepository,
    billsRepository,
    allocationsRepository,
    financePaymentsRepository,
  };
}

describe('FinanceTeamPaymentReconciliationService', () => {
  it('marks a Team payment as paid from a fully settled Finance bill', async () => {
    const teamPayment = makeTeamPayment();
    const bill = makeBill({
      status: FinanceBillStatus.Paid,
      paidAmount: '100.00',
      balanceDue: '0.00',
      paidAt: new Date('2026-07-15T12:00:00.000Z'),
    });
    const financePayment = makeFinancePayment();
    const { service, teamPaymentsRepository } = makeService({
      bills: [bill],
      allocations: [makeAllocation()],
      financePayments: [financePayment],
    });

    const reconciled = await service.reconcilePayment(CTX, teamPayment);

    expect(reconciled.status).toBe(TeamPaymentStatus.Paid);
    expect(reconciled.financePaymentId).toBe(financePayment.id);
    expect(reconciled.paidAt).toEqual(bill.paidAt);
    expect(reconciled.metadata).toEqual(
      expect.objectContaining({
        financePaymentIds: [financePayment.id],
        financePaymentPending: false,
        financeBillStatus: FinanceBillStatus.Paid,
        financeReconciliationSource: 'finance_bill',
      }),
    );
    expect(teamPaymentsRepository.save).toHaveBeenCalledWith([teamPayment]);
  });

  it('keeps a partially paid competence pending and records its Finance payment', async () => {
    const teamPayment = makeTeamPayment();
    const financePayment = makeFinancePayment({
      amount: '40.00',
      allocatedAmount: '40.00',
    });
    const { service } = makeService({
      bills: [
        makeBill({
          status: FinanceBillStatus.PartiallyPaid,
          paidAmount: '40.00',
          balanceDue: '60.00',
        }),
      ],
      allocations: [makeAllocation({ amount: '40.00' })],
      financePayments: [financePayment],
    });

    const reconciled = await service.reconcilePayment(CTX, teamPayment);

    expect(reconciled.status).toBe(TeamPaymentStatus.PaymentPending);
    expect(reconciled.financePaymentId).toBe(financePayment.id);
    expect(reconciled.paidAt).toBeNull();
    expect(reconciled.metadata.financePaymentPending).toBe(true);
  });

  it('moves a previously paid competence back to pending after a Finance reversal', async () => {
    const teamPayment = makeTeamPayment({
      status: TeamPaymentStatus.Paid,
      financePaymentId: 'finance-payment-1',
      paidAt: new Date('2026-07-15T12:00:00.000Z'),
      metadata: {
        financePaymentIds: ['finance-payment-1'],
        financePaymentPending: false,
      },
    });
    const { service } = makeService({
      bills: [makeBill()],
      allocations: [],
      financePayments: [],
    });

    const reconciled = await service.reconcilePayment(CTX, teamPayment);

    expect(reconciled.status).toBe(TeamPaymentStatus.PaymentPending);
    expect(reconciled.financePaymentId).toBeNull();
    expect(reconciled.paidAt).toBeNull();
    expect(reconciled.metadata.financePaymentIds).toEqual([]);
    expect(reconciled.metadata.financePaymentPending).toBe(true);
  });

  it('does not keep Team paid when the linked Finance bill is cancelled', async () => {
    const teamPayment = makeTeamPayment({
      status: TeamPaymentStatus.Paid,
      financePaymentId: 'finance-payment-1',
      paidAt: new Date('2026-07-15T12:00:00.000Z'),
    });
    const { service } = makeService({
      bills: [
        makeBill({
          status: FinanceBillStatus.Cancelled,
          paidAmount: '100.00',
          balanceDue: '0.00',
        }),
      ],
      allocations: [makeAllocation()],
      financePayments: [makeFinancePayment()],
    });

    const reconciled = await service.reconcilePayment(CTX, teamPayment);

    expect(reconciled.status).toBe(TeamPaymentStatus.PaymentPending);
    expect(reconciled.paidAt).toBeNull();
  });

  it('does not recognize a completed but unallocated Finance payment', async () => {
    const teamPayment = makeTeamPayment();
    const { service, financePaymentsRepository } = makeService({
      bills: [makeBill()],
      allocations: [],
      financePayments: [makeFinancePayment()],
    });

    const reconciled = await service.reconcilePayment(CTX, teamPayment);

    expect(reconciled.status).toBe(TeamPaymentStatus.PaymentPending);
    expect(reconciled.financePaymentId).toBeNull();
    expect(financePaymentsRepository.find).not.toHaveBeenCalled();
  });

  it('is idempotent when Team already reflects the current Finance state', async () => {
    const paidAt = new Date('2026-07-15T12:00:00.000Z');
    const teamPayment = makeTeamPayment({
      status: TeamPaymentStatus.Paid,
      financePaymentId: 'finance-payment-1',
      paidAt,
      metadata: {
        financePaymentIds: ['finance-payment-1'],
        financePaymentPending: false,
        financeBillStatus: FinanceBillStatus.Paid,
      },
    });
    const { service, teamPaymentsRepository } = makeService({
      bills: [
        makeBill({
          status: FinanceBillStatus.Paid,
          paidAmount: '100.00',
          balanceDue: '0.00',
          paidAt,
        }),
      ],
      allocations: [makeAllocation()],
      financePayments: [makeFinancePayment()],
    });

    await service.reconcilePayment(CTX, teamPayment);

    expect(teamPaymentsRepository.save).not.toHaveBeenCalled();
  });

  it('loads Finance state in batches for multiple Team payments', async () => {
    const first = makeTeamPayment();
    const second = makeTeamPayment({
      id: 'team-payment-2',
      financeBillId: 'bill-2',
    });
    const { service, billsRepository, allocationsRepository } = makeService({
      bills: [
        makeBill(),
        makeBill({ id: 'bill-2', totalAmount: '200.00', balanceDue: '200.00' }),
      ],
      allocations: [],
      financePayments: [],
    });

    await service.reconcilePayments(CTX, [first, second]);

    expect(billsRepository.find).toHaveBeenCalledTimes(1);
    expect(allocationsRepository.find).toHaveBeenCalledTimes(1);
  });

  it('repairs linked payments in the requested Team list scope', async () => {
    const teamPayment = makeTeamPayment({ memberId: 'member-1' });
    const { service, teamPaymentsRepository } = makeService({
      teamPayments: [teamPayment],
      bills: [makeBill()],
      allocations: [],
      financePayments: [],
    });

    await service.reconcileWorkspacePayments(CTX, {
      memberId: 'member-1',
      competenceStart: '2026-07-01',
      competenceEnd: '2026-07-31',
    });

    expect(teamPaymentsRepository.find).toHaveBeenCalledTimes(1);
    const findOptions = teamPaymentsRepository.find.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(findOptions.where).toMatchObject({
      tenantId: CTX.tenantId,
      workspaceId: CTX.workspaceId,
      memberId: 'member-1',
    });
  });
});
