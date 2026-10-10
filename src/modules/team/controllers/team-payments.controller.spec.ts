import { TeamPaymentStatus } from '../enums';
import { TeamPaymentsController } from './team-payments.controller';

const CONTEXT = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  role: 'owner',
  sessionId: 'session-1',
};

function makePayment(status = TeamPaymentStatus.PaymentPending) {
  return {
    id: 'team-payment-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    financeBillId: 'bill-1',
    status,
    metadata: {},
  };
}

function makeController() {
  const payment = makePayment();
  const reconciled = makePayment(TeamPaymentStatus.Paid);
  const teamPaymentsService = {
    listPayments: jest.fn(() => Promise.resolve([reconciled])),
    getPayment: jest.fn(() => Promise.resolve(payment)),
    getPaymentFinanceStatus: jest.fn(() =>
      Promise.resolve({
        financeBillId: 'bill-1',
        financePaymentId: 'finance-payment-1',
      }),
    ),
  };
  const financeReconciliationService = {
    reconcileWorkspacePayments: jest.fn(() => Promise.resolve([reconciled])),
    reconcilePayment: jest.fn(() => Promise.resolve(reconciled)),
  };
  const controller = new TeamPaymentsController(
    teamPaymentsService as never,
    financeReconciliationService as never,
  );

  return {
    controller,
    payment,
    reconciled,
    teamPaymentsService,
    financeReconciliationService,
  };
}

describe('TeamPaymentsController Finance reconciliation', () => {
  it('repairs Finance state before listing Team payments', async () => {
    const {
      controller,
      reconciled,
      teamPaymentsService,
      financeReconciliationService,
    } = makeController();

    const result = await controller.listPayments(CONTEXT, {
      memberId: 'member-1',
      competenceStart: '2026-07-01',
      competenceEnd: '2026-07-31',
    });

    expect(result).toEqual([reconciled]);
    expect(
      financeReconciliationService.reconcileWorkspacePayments,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      }),
      {
        memberId: 'member-1',
        batchId: undefined,
        competenceStart: '2026-07-01',
        competenceEnd: '2026-07-31',
      },
    );
    expect(
      financeReconciliationService.reconcileWorkspacePayments.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      teamPaymentsService.listPayments.mock.invocationCallOrder[0],
    );
  });

  it('returns the reconciled state from the Team payment detail endpoint', async () => {
    const { controller, reconciled, financeReconciliationService } =
      makeController();

    const result = await controller.getPayment(CONTEXT, 'team-payment-1');

    expect(result).toBe(reconciled);
    expect(financeReconciliationService.reconcilePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      }),
      expect.objectContaining({ id: 'team-payment-1' }),
    );
  });

  it('keeps Team available when Finance reconciliation fails', async () => {
    const {
      controller,
      reconciled,
      teamPaymentsService,
      financeReconciliationService,
    } = makeController();
    financeReconciliationService.reconcileWorkspacePayments.mockRejectedValueOnce(
      new Error('Finance unavailable'),
    );

    const result = await controller.listPayments(CONTEXT, {});

    expect(result).toEqual([reconciled]);
    expect(teamPaymentsService.listPayments).toHaveBeenCalled();
  });

  it('reconciles before returning the Finance status drawer data', async () => {
    const { controller, teamPaymentsService, financeReconciliationService } =
      makeController();

    const result = await controller.getPaymentFinanceStatus(
      CONTEXT,
      'team-payment-1',
    );

    expect(result).toEqual({
      financeBillId: 'bill-1',
      financePaymentId: 'finance-payment-1',
    });
    expect(financeReconciliationService.reconcilePayment).toHaveBeenCalled();
    expect(
      financeReconciliationService.reconcilePayment.mock.invocationCallOrder[0],
    ).toBeLessThan(
      teamPaymentsService.getPaymentFinanceStatus.mock.invocationCallOrder[0],
    );
  });
});
