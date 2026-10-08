import { Between } from 'typeorm';
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
    recurringProfilesRepo: repo(data.profiles),
    clientsRepo: repo(data.clients),
    categoriesRepo: repo(),
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
