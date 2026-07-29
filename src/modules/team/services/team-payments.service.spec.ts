import { BadRequestException } from '@nestjs/common';
import { TeamPaymentsService } from './team-payments.service';
import { TeamPaymentItemType, TeamPaymentStatus } from '../enums';
import { FinanceBillStatus } from '../../finance/enums';

type AnyRecord = Record<string, unknown>;

const CTX = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
};

function makePayment(overrides: AnyRecord = {}) {
  return {
    id: 'pay-1',
    tenantId: CTX.tenantId,
    workspaceId: CTX.workspaceId,
    memberId: 'member-1',
    batchId: null,
    financeBillId: null,
    financePaymentId: null,
    competenceStart: '2026-06-01',
    competenceEnd: '2026-06-30',
    dueDate: '2026-07-05',
    status: TeamPaymentStatus.Draft,
    currency: 'BRL',
    grossAmount: '3000.00',
    benefitsTotal: '0.00',
    discountsTotal: '0.00',
    netAmount: '3000.00',
    metadata: {},
    member: {
      id: 'member-1',
      displayName: 'João',
      contactId: 'contact-1',
      workerType: 'contractor',
    },
    items: [],
    ...overrides,
  } as AnyRecord;
}

function makeRule(metadata: AnyRecord) {
  return {
    id: 'rule-1',
    type: 'payment_finance_setting',
    status: 'active',
    name: 'Regra contractor',
    metadata: { relationshipTypes: ['contractor'], ...metadata },
  };
}

function makeService(opts: {
  payment: AnyRecord;
  rules?: AnyRecord[];
  existingBill?: AnyRecord | null;
}) {
  const createBill = jest.fn(async (_ctx: unknown, _dto: unknown) => ({
    id: 'bill-1',
    status: FinanceBillStatus.Open,
  }));
  const getBill = jest.fn(async (_ctx: unknown, id: string) => ({
    id,
    status: FinanceBillStatus.Open,
  }));

  const paymentRepository = {
    findOne: jest.fn(async () => opts.payment),
    save: jest.fn(async (p: AnyRecord) => p),
  };
  const configOptionRepository = {
    find: jest.fn(async () => opts.rules ?? []),
  };
  const qb = {
    where: () => qb,
    andWhere: () => qb,
    getOne: jest.fn(async () => opts.existingBill ?? null),
  };
  const financeBillRepository = {
    createQueryBuilder: jest.fn(() => qb),
  };
  const financeBillingService = { createBill, getBill };
  const agencyContactsService = { createContact: jest.fn() };

  const service = new TeamPaymentsService(
    {} as never, // batchRepository
    paymentRepository as never,
    {} as never, // itemRepository
    {} as never, // documentRepository
    {} as never, // memberRepository
    {} as never, // attendanceRepository
    configOptionRepository as never,
    financeBillRepository as never,
    financeBillingService as never,
    {} as never, // pdfRendererService
    agencyContactsService as never,
  );

  return {
    service,
    createBill,
    getBill,
    paymentRepository,
    qb,
  };
}

describe('TeamPaymentsService — Team → Finance integration', () => {
  it('does not create a bill when the rule requires approval (pending_approval)', async () => {
    const payment = makePayment();
    const { service, createBill, paymentRepository } = makeService({
      payment,
      rules: [
        makeRule({ createPayable: true, requireApprovalBeforeFinance: true }),
      ],
    });

    const result = (await service.confirmPayment(
      CTX,
      'pay-1',
    )) as unknown as AnyRecord;

    expect(createBill).not.toHaveBeenCalled();
    expect(result.status).toBe(TeamPaymentStatus.Confirmed);
    expect(result.financeBillId).toBeNull();
    expect((result.metadata as AnyRecord).financeApprovalStatus).toBe(
      'pending_approval',
    );
    expect(paymentRepository.save).toHaveBeenCalled();
  });

  it('creates the bill on confirm when no approval is required', async () => {
    const payment = makePayment();
    const { service, createBill } = makeService({
      payment,
      rules: [
        makeRule({ createPayable: true, requireApprovalBeforeFinance: false }),
      ],
    });

    const result = (await service.confirmPayment(
      CTX,
      'pay-1',
    )) as unknown as AnyRecord;

    expect(createBill).toHaveBeenCalledTimes(1);
    expect(result.financeBillId).toBe('bill-1');
    expect(result.status).toBe(TeamPaymentStatus.PaymentPending);
  });

  it('skips Finance entirely when the rule does not generate a payable', async () => {
    const payment = makePayment();
    const { service, createBill } = makeService({
      payment,
      rules: [makeRule({ createPayable: false, createExpense: true })],
    });

    const result = (await service.confirmPayment(
      CTX,
      'pay-1',
    )) as unknown as AnyRecord;

    expect(createBill).not.toHaveBeenCalled();
    expect(result.financeBillId).toBeNull();
    expect((result.metadata as AnyRecord).financeIntegrationSkipped).toBe(true);
    expect((result.metadata as AnyRecord).financeSkipReason).toBe(
      'expense_only_unsupported',
    );
  });

  it('generates a payable on approve and marks it approved', async () => {
    const payment = makePayment({
      status: TeamPaymentStatus.Confirmed,
      metadata: {
        financeApprovalRequired: true,
        financeApprovalStatus: 'pending_approval',
      },
    });
    const { service, createBill } = makeService({
      payment,
      rules: [
        makeRule({ createPayable: true, requireApprovalBeforeFinance: true }),
      ],
    });

    const result = (await service.approvePayment(
      CTX,
      'pay-1',
    )) as unknown as AnyRecord;

    expect(createBill).toHaveBeenCalledTimes(1);
    expect(result.financeBillId).toBe('bill-1');
    expect(result.status).toBe(TeamPaymentStatus.PaymentPending);
    expect((result.metadata as AnyRecord).financeApprovalStatus).toBe(
      'approved',
    );
  });

  it('is idempotent: reuses an existing bill instead of creating a duplicate', async () => {
    const payment = makePayment({ status: TeamPaymentStatus.Confirmed });
    const { service, createBill, getBill } = makeService({
      payment,
      rules: [
        makeRule({ createPayable: true, requireApprovalBeforeFinance: false }),
      ],
      existingBill: { id: 'bill-existing', status: FinanceBillStatus.Open },
    });

    const result = (await service.sendPaymentToFinance(
      CTX,
      'pay-1',
    )) as unknown as AnyRecord;

    expect(createBill).not.toHaveBeenCalled();
    expect(getBill).toHaveBeenCalledWith(expect.anything(), 'bill-existing');
    expect(result.financeBillId).toBe('bill-existing');
  });

  it('builds bill lines with a negative discount and per-line metadata', async () => {
    const payment = makePayment({
      grossAmount: '3000.00',
      discountsTotal: '200.00',
      netAmount: '2800.00',
      items: [
        {
          id: 'it-base',
          type: TeamPaymentItemType.Base,
          name: 'Salário',
          amount: '3000.00',
        },
        {
          id: 'it-disc',
          type: TeamPaymentItemType.Discount,
          name: 'Vale',
          amount: '200.00',
        },
      ],
    });
    const { service, createBill } = makeService({
      payment,
      rules: [
        makeRule({
          createPayable: true,
          requireApprovalBeforeFinance: false,
          defaultCategoryId: 'cat-1',
          defaultCostCenterId: 'cc-1',
        }),
      ],
    });

    await service.confirmPayment(CTX, 'pay-1');

    const dto = createBill.mock.calls[0][1] as AnyRecord;
    const lines = dto.lines as AnyRecord[];
    expect(lines).toHaveLength(2);
    const base = lines.find((l) => l.description === 'Salário')!;
    const discount = lines.find((l) =>
      String(l.description).startsWith('Desconto'),
    )!;
    expect(base.unitPrice).toBe('3000.00');
    expect(discount.unitPrice).toBe('-200.00');
    // Per-line classification preserved.
    expect(base.categoryId).toBe('cat-1');
    expect(base.costCenterId).toBe('cc-1');
    expect((base.metadata as AnyRecord).teamPaymentId).toBe('pay-1');
    expect((base.metadata as AnyRecord).teamPaymentLineId).toBe('it-base');
    expect((base.metadata as AnyRecord).itemType).toBe(
      TeamPaymentItemType.Base,
    );
    // Bill-level origin/idempotency metadata.
    expect((dto.metadata as AnyRecord).teamPaymentOccurrenceKey).toBe(
      'team_payment:pay-1',
    );
    expect((dto.metadata as AnyRecord).sourceModule).toBe('team');
  });

  it('blocks sending to Finance when approval is still pending', async () => {
    const payment = makePayment({
      status: TeamPaymentStatus.Confirmed,
      metadata: {
        financeApprovalRequired: true,
        financeApprovalStatus: 'pending_approval',
      },
    });
    const { service } = makeService({
      payment,
      rules: [
        makeRule({ createPayable: true, requireApprovalBeforeFinance: true }),
      ],
    });

    await expect(
      service.sendPaymentToFinance(CTX, 'pay-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
