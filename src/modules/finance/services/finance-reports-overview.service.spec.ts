import { Between } from 'typeorm';
import { FinanceMetricKey } from '../enums';
import { FinanceService } from './finance.service';

const context = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
};
const createdAt = new Date('2026-09-01T12:00:00Z');

function makeService(
  data: {
    clients?: Record<string, unknown>[];
    profiles?: Record<string, unknown>[];
    invoices?: Record<string, unknown>[];
    bills?: Record<string, unknown>[];
    payments?: Record<string, unknown>[];
    billLines?: Record<string, unknown>[];
    categories?: Record<string, unknown>[];
  } = {},
) {
  const repo = (rows: Record<string, unknown>[] = []) => ({
    find: jest.fn().mockResolvedValue(rows),
    count: jest.fn().mockResolvedValue(0),
  });
  const paymentsRepo = repo(data.payments);
  // Only the repositories read by the report participate in this fixture.
  const service = Object.create(FinanceService.prototype) as FinanceService;
  Object.assign(service, {
    getSettings: jest.fn().mockResolvedValue({ baseCurrency: 'BRL' }),
    invoicesRepo: repo(data.invoices),
    billsRepo: repo(data.bills),
    billLinesRepo: repo(data.billLines),
    recurringProfilesRepo: repo(data.profiles),
    clientsRepo: repo(data.clients),
    categoriesRepo: repo(data.categories),
    metricSnapshotsRepo: repo(),
    reportSnapshotsRepo: repo(),
    paymentsRepo,
  });
  return { service, paymentsRepo };
}

function client(
  id: string,
  status: string,
  fee: number,
  archivedAt: Date | null = null,
) {
  return {
    id,
    contactId: `contact-${id}`,
    status,
    archivedAt,
    createdAt,
    updatedAt: createdAt,
    metadata: { billing: { monthlyFee: fee } },
  };
}

function profile(
  id: string,
  customerId: string | null,
  amount: number,
  overrides = {},
) {
  return {
    id,
    customerId,
    amount: String(amount),
    status: 'active',
    interval: 'monthly',
    startDate: '2026-09-01',
    endDate: null,
    ...overrides,
  };
}

function payment(direction: string, amount: number, overrides = {}) {
  return {
    direction,
    amount: String(amount),
    status: 'completed',
    paymentDate: '2026-10-08',
    currency: 'BRL',
    ...overrides,
  };
}

describe('FinanceService reports overview', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-08T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('classifies costs by bill items with document fallback and no double counting', async () => {
    const { service } = makeService({
      categories: [
        { id: 'fixed', costBehavior: 'fixed' },
        { id: 'variable', costBehavior: 'variable' },
      ],
      invoices: [
        {
          issueDate: '2026-10-01',
          status: 'issued',
          totalAmount: '1000',
          balanceDue: '1000',
        },
      ],
      bills: [
        {
          id: 'items',
          issueDate: '2026-10-01',
          status: 'open',
          totalAmount: '500',
          categoryId: 'fixed',
        },
        {
          id: 'legacy',
          issueDate: '2026-10-01',
          status: 'open',
          totalAmount: '100',
          categoryId: 'fixed',
        },
        {
          id: 'cancelled',
          issueDate: '2026-10-01',
          status: 'cancelled',
          totalAmount: '999',
        },
        {
          id: 'older',
          issueDate: '2026-09-01',
          status: 'open',
          totalAmount: '999',
        },
      ],
      billLines: [
        { billId: 'items', totalAmount: '200', categoryId: 'fixed' },
        { billId: 'items', totalAmount: '100', categoryId: 'variable' },
        { billId: 'items', totalAmount: '200', categoryId: null },
        { billId: 'cancelled', totalAmount: '999', categoryId: 'fixed' },
        { billId: 'older', totalAmount: '999', categoryId: 'fixed' },
      ],
    });
    const result = await service.getReportsOverview(context);
    expect(result.cards.fixedCosts).toBe(500);
    expect(result.cards.variableCosts).toBe(100);
    expect(result.cards.breakEvenPoint).toBe(555.56);
  });

  it('recognizes fixed categories on items when the bill has no category', async () => {
    const { service } = makeService({
      categories: [{ id: 'fixed', costBehavior: 'fixed' }],
      invoices: [
        {
          issueDate: '2026-10-01',
          status: 'issued',
          totalAmount: '1000',
          balanceDue: '1000',
        },
      ],
      bills: [
        {
          id: 'bill',
          issueDate: '2026-10-01',
          status: 'open',
          totalAmount: '300',
          categoryId: null,
        },
      ],
      billLines: [{ billId: 'bill', totalAmount: '300', categoryId: 'fixed' }],
    });
    const result = await service.getReportsOverview(context);
    expect(result.cards.fixedCosts).toBe(300);
    expect(result.cards.variableCosts).toBe(0);
    expect(result.cards.breakEvenPoint).toBe(300);
  });

  it('excludes recurring profiles of inactive or archived clients from MRR and active contracts', async () => {
    const { service } = makeService({
      clients: [
        client('active', 'active', 1000),
        client('ended', 'ended', 2000),
        client('archived', 'active', 3000, createdAt),
        client('paused', 'paused', 4000),
      ],
      profiles: [
        profile('active-profile', 'contact-active', 1100),
        profile('ended-profile', 'contact-ended', 2000),
        profile('archived-profile', 'contact-archived', 3000),
        profile('paused-profile', 'contact-paused', 4000),
      ],
    });
    const result = await service.getReportsOverview(context);
    expect(result.cards.mrr).toBe(1100);
    expect(result.cards.activeContracts).toBe(1);
  });

  it('keeps standalone recurrence and contracted fees without counting a linked client twice', async () => {
    const { service } = makeService({
      clients: [
        client('linked', 'active', 1000),
        client('fee-only', 'active', 500),
      ],
      profiles: [
        profile('linked-profile', 'contact-linked', 1000),
        profile('standalone', 'finance-only-contact', 250),
        profile('no-contact', null, 125),
      ],
    });
    const result = await service.getReportsOverview(context);
    expect(result.cards.mrr).toBe(1875);
    expect(result.cards.activeContracts).toBe(4);
  });

  it('excludes expired, future and non-active recurring profiles', async () => {
    const { service } = makeService({
      profiles: [
        profile('expired', null, 5000, { endDate: '2026-10-07' }),
        profile('future', null, 6000, { startDate: '2026-10-09' }),
        profile('cancelled', null, 7000, { status: 'cancelled' }),
        profile('current', null, 100, {
          startDate: '2026-10-08',
          endDate: '2026-10-08',
        }),
      ],
    });
    const result = await service.getReportsOverview(context);
    expect(result.cards.mrr).toBe(100);
    expect(result.cards.activeContracts).toBe(1);
  });

  it('uses completed payments of the month, including payments for older documents and unallocated payments', async () => {
    const { service, paymentsRepo } = makeService({
      invoices: [
        {
          issueDate: '2026-09-15',
          createdAt,
          status: 'paid',
          totalAmount: '500',
          paidAmount: '500',
          balanceDue: '0',
        },
      ],
      bills: [
        {
          issueDate: '2026-09-15',
          createdAt,
          status: 'paid',
          totalAmount: '200',
        },
      ],
      payments: [
        payment('customer', 500),
        payment('customer', 125.5, { allocatedAmount: '0' }),
        payment('vendor', 200),
        payment('vendor', 25.25, { allocatedAmount: '0' }),
      ],
    });
    const result = await service.getReportsOverview(context);
    expect(result.cards.revenueReceived).toBe(625.5);
    expect(result.cards).toEqual(
      expect.objectContaining({ costsPaid: 225.25 }),
    );
    // Accrual costs keep their existing definition; they are not cash outflows.
    expect(result.cards.fixedCosts + result.cards.variableCosts).toBe(0);
    expect(paymentsRepo.find).toHaveBeenCalledWith({
      where: {
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
        status: 'completed',
        paymentDate: Between('2026-10-01', '2026-10-31'),
      },
    });
  });

  it('does not report unpaid invoices and bills as cash movements', async () => {
    const { service } = makeService({
      invoices: [
        {
          issueDate: '2026-10-01',
          createdAt,
          status: 'sent',
          totalAmount: '900',
          paidAmount: '0',
          balanceDue: '900',
        },
      ],
      bills: [
        {
          issueDate: '2026-10-01',
          createdAt,
          status: 'open',
          totalAmount: '400',
        },
      ],
    });
    const result = await service.getReportsOverview(context);
    expect(result.cards.revenueReceived).toBe(0);
    expect(result.cards).toEqual(expect.objectContaining({ costsPaid: 0 }));
    expect(result.cards.variableCosts).toBe(400);
  });
});

describe('Finance monthly history without snapshots', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-15T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  function historyService(snapshots: Record<string, unknown>[] = []) {
    const { service } = makeService({
      invoices: [
        {
          issueDate: '2026-08-10',
          totalAmount: '1000',
          status: 'issued',
          balanceDue: '1000',
          createdAt,
        },
      ],
      bills: [
        {
          issueDate: '2026-08-10',
          totalAmount: '200',
          status: 'open',
          createdAt,
        },
      ],
      clients: [
        client('old', 'ended', 100, new Date('2026-09-12T12:00:00Z')),
        {
          ...client('current', 'active', 100),
          createdAt: new Date('2026-01-01'),
        },
      ],
    });
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(snapshots),
    };
    const metricsRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      count: jest.fn().mockResolvedValue(0),
      save: jest.fn(),
    };
    Object.assign(service, { metricSnapshotsRepo: metricsRepo });
    return { service, qb, metricsRepo };
  }

  it('fills twelve months from canonical calculations with one scoped source fetch and no snapshot writes', async () => {
    const { service, qb, metricsRepo } = historyService();
    const result = await service.getMetricsHistory(context, {
      periodType: 'monthly',
    });
    expect(result.data).toHaveLength(48);
    expect(
      result.data.find(
        (row) =>
          row.metricKey === FinanceMetricKey.GrossMargin &&
          row.periodStart === '2026-08-01',
      )?.value,
    ).toBe(0.8);
    expect(
      result.data.find(
        (row) =>
          row.metricKey === FinanceMetricKey.NetMargin &&
          row.periodStart === '2026-08-01',
      )?.value,
    ).toBe(0.8);
    expect(
      result.data.find(
        (row) =>
          row.metricKey === FinanceMetricKey.CustomerChurn &&
          row.periodStart === '2026-09-01',
      )?.value,
    ).toBeGreaterThan(0);
    expect(jest.mocked(service).getSettings.mock.calls).toHaveLength(1);
    expect(qb.where).toHaveBeenCalledWith('metric.tenant_id = :tenantId', {
      tenantId: context.tenantId,
    });
    expect(qb.andWhere).toHaveBeenCalledWith(
      'metric.workspace_id = :workspaceId',
      { workspaceId: context.workspaceId },
    );
    expect(metricsRepo.save).not.toHaveBeenCalled();
  });

  it('keeps persisted values and honors metric/date filters for the calculated projection', async () => {
    const { service } = historyService([
      {
        id: 'saved',
        metricKey: 'gross_margin',
        periodType: 'monthly',
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
        value: '.73',
        currency: 'BRL',
        metadata: {},
        source: 'monthly_snapshot',
        calculatedAt: createdAt,
      },
    ]);
    const result = await service.getMetricsHistory(context, {
      metricKey: 'grossMargin',
      periodType: 'monthly',
      startDate: '2026-08-01',
      endDate: '2026-09-30',
    });
    expect(result.data.map((row) => [row.periodStart, row.value])).toEqual([
      ['2026-08-01', 0.73],
      ['2026-09-01', 0],
    ]);
    expect(result.data[0].id).toBe('saved');
  });
});
