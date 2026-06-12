import { DataSource, Repository } from 'typeorm';
import {
  FinanceBankAccount,
  FinanceBill,
  FinanceBillLine,
  FinanceInvoice,
  FinanceInvoiceLine,
  FinancePayment,
  FinancePaymentAllocation,
  FinanceRecurringProfile,
  FinanceSetting,
} from '../entities';
import {
  FinanceAllocationTargetType,
  FinanceBillStatus,
  FinanceInvoiceStatus,
  FinancePaymentDirection,
  FinancePaymentMethod,
  FinancePaymentStatus,
  FinanceRecurringInterval,
  FinanceRecurringProfileStatus,
} from '../enums';
import { FinanceDocumentNumberingService } from './finance-document-numbering.service';
import { FinanceJournalEntryService } from './finance-journal-entry.service';
import { FinanceNotificationPublisher } from './finance-notification.publisher';
import { FinanceBillingService } from './finance-billing.service';

describe('FinanceBillingService notification triggers', () => {
  it('publishes invoice_issued on draft to issued transition without using metadata recipients', async () => {
    const invoice = makeInvoice({
      status: FinanceInvoiceStatus.Draft,
      metadata: {
        ownerUserId: 'user-owner',
        requesterUserId: 'user-requester',
        responsibleUserId: '11111111-1111-1111-1111-111111111111',
      },
    });
    const { service, publisher } = makeService({ invoice });

    await service.issueInvoice(makeContext(), invoice.id);

    expect(publisher.publishInvoiceIssued).toHaveBeenCalledTimes(1);
    expect(publisher.publishInvoiceIssued).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-actor',
        resource: expect.objectContaining({
          id: invoice.id,
          status: FinanceInvoiceStatus.Issued,
        }),
        recipients: [],
      }),
    );
  });

  it('does not republish invoice_issued when invoice is already issued', async () => {
    const invoice = makeInvoice({
      status: FinanceInvoiceStatus.Issued,
      issuedAt: new Date('2026-06-12T11:00:00.000Z'),
      metadata: { ownerUserId: 'user-owner' },
    });
    const { service, publisher } = makeService({ invoice });

    await service.issueInvoice(makeContext(), invoice.id);

    expect(publisher.publishInvoiceIssued).not.toHaveBeenCalled();
  });

  it('publishes payment_received when a customer payment is created as completed, without using metadata recipients', async () => {
    const { service, publisher } = makeService();

    await service.createPayment(makeContext(), {
      direction: FinancePaymentDirection.Customer,
      status: FinancePaymentStatus.Completed,
      method: FinancePaymentMethod.Pix,
      paymentDate: '2026-06-12',
      amount: '100.00',
      metadata: {
        ownerUserId: 'user-owner',
        requesterUserId: '22222222-2222-2222-2222-222222222222',
      },
    });

    expect(publisher.publishPaymentReceived).toHaveBeenCalledTimes(1);
    expect(publisher.publishPaymentReceived).toHaveBeenCalledWith(
      expect.objectContaining({ recipients: [] }),
    );
  });

  it('publishes payment_failed on transition to failed without using metadata recipients', async () => {
    const payment = makePayment({
      status: FinancePaymentStatus.Pending,
      metadata: { responsibleUserId: 'user-owner' },
    });
    const { service, publisher } = makeService({ payment });

    await service.updatePayment(makeContext(), payment.id, {
      status: FinancePaymentStatus.Failed,
    });

    expect(publisher.publishPaymentFailed).toHaveBeenCalledTimes(1);
    expect(publisher.publishPaymentFailed).toHaveBeenCalledWith(
      expect.objectContaining({ recipients: [] }),
    );
  });

  it('publishes invoice_paid after allocation pays an invoice without duplicating payment_received', async () => {
    const payment = makePayment({
      direction: FinancePaymentDirection.Customer,
      amount: '100.00',
      allocatedAmount: '0.00',
      metadata: { ownerUserId: 'user-payment-owner' },
    });
    const invoice = makeInvoice({
      status: FinanceInvoiceStatus.Issued,
      balanceDue: '100.00',
      paidAmount: '0.00',
      metadata: { ownerUserId: 'user-invoice-owner' },
    });
    const { service, publisher } = makeService({ payment, invoice });

    await service.allocatePayment(makeContext(), payment.id, {
      targetType: FinanceAllocationTargetType.Invoice,
      targetId: invoice.id,
      amount: '100.00',
    });

    expect(publisher.publishInvoicePaid).toHaveBeenCalledTimes(1);
    expect(publisher.publishInvoicePaid).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({
          id: invoice.id,
          status: FinanceInvoiceStatus.Paid,
        }),
        recipients: [],
      }),
    );
    expect(publisher.publishPaymentReceived).not.toHaveBeenCalled();
  });

  it('publishes bill_paid after a vendor payment fully allocates a bill, without using metadata recipients', async () => {
    const payment = makePayment({
      direction: FinancePaymentDirection.Vendor,
      amount: '50.00',
      allocatedAmount: '0.00',
      metadata: { ownerUserId: 'user-payment-owner' },
    });
    const bill = makeBill({
      status: FinanceBillStatus.Open,
      balanceDue: '50.00',
      paidAmount: '0.00',
      metadata: { ownerUserId: 'user-bill-owner' },
    });
    const { service, publisher } = makeService({ payment, bill });

    await service.allocatePayment(makeContext(), payment.id, {
      targetType: FinanceAllocationTargetType.Bill,
      targetId: bill.id,
      amount: '50.00',
    });

    expect(publisher.publishBillPaid).toHaveBeenCalledTimes(1);
    expect(publisher.publishBillPaid).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: expect.objectContaining({
          id: bill.id,
          status: FinanceBillStatus.Paid,
        }),
        recipients: [],
      }),
    );
  });

  it('does not auto-fire finance.recurring_charge_created when generating an invoice from a recurring profile', async () => {
    const profile = makeRecurringProfile({
      metadata: { ownerUserId: 'user-owner' },
    });
    const { service, publisher, invoicesRepo } = makeService({
      recurringProfile: profile,
    });

    invoicesRepo.findOne.mockResolvedValueOnce(null);

    await service.generateInvoiceFromRecurringProfile(makeContext(), profile.id);

    expect(publisher.publishRecurringChargeCreated).not.toHaveBeenCalled();
  });
});

function makeService(options: {
  invoice?: FinanceInvoice;
  payment?: FinancePayment;
  bill?: FinanceBill;
  recurringProfile?: FinanceRecurringProfile;
} = {}) {
  const invoice = options.invoice ?? makeInvoice();
  const payment = options.payment ?? makePayment();
  const bill = options.bill ?? makeBill();
  const recurringProfile = options.recurringProfile ?? makeRecurringProfile();

  const invoicesRepo = {
    findOne: jest.fn().mockResolvedValue(invoice),
    save: jest.fn(async (item: FinanceInvoice) => item),
    count: jest.fn().mockResolvedValue(0),
  };
  const invoiceLinesRepo = {
    find: jest.fn().mockResolvedValue([]),
  };
  const billsRepo = {
    findOne: jest.fn().mockResolvedValue(bill),
    save: jest.fn(async (item: FinanceBill) => item),
    count: jest.fn().mockResolvedValue(0),
  };
  const paymentsRepo = {
    create: jest.fn((value: Partial<FinancePayment>) =>
      makePayment({
        ...value,
        metadata: value.metadata ?? {},
      }),
    ),
    findOne: jest.fn().mockResolvedValue(payment),
    save: jest.fn(async (item: FinancePayment) => item),
  };
  const paymentAllocationsRepo = {};
  const settingsRepo = {
    findOne: jest.fn().mockResolvedValue(makeFinanceSettings()),
    create: jest.fn((value: Partial<FinanceSetting>) => value),
    save: jest.fn(async (value: Partial<FinanceSetting>) => ({
      ...makeFinanceSettings(),
      ...value,
    })),
  };
  const recurringProfilesRepo = {
    findOne: jest.fn().mockResolvedValue(recurringProfile),
    find: jest.fn().mockResolvedValue([recurringProfile]),
    save: jest.fn(async (item: FinanceRecurringProfile) => item),
  };
  const dataSource = {
    transaction: jest.fn(async (callback: (manager: any) => Promise<unknown>) =>
      callback(
        makeTransactionManager({ invoice, bill, payment, recurringProfile }),
      ),
    ),
  };
  const publisher = makePublisher();
  const service = new FinanceBillingService(
    invoicesRepo as unknown as Repository<FinanceInvoice>,
    invoiceLinesRepo as unknown as Repository<FinanceInvoiceLine>,
    billsRepo as unknown as Repository<FinanceBill>,
    {} as Repository<FinanceBillLine>,
    paymentsRepo as unknown as Repository<FinancePayment>,
    paymentAllocationsRepo as unknown as Repository<FinancePaymentAllocation>,
    { findOne: jest.fn().mockResolvedValue(null) } as unknown as Repository<FinanceBankAccount>,
    recurringProfilesRepo as unknown as Repository<FinanceRecurringProfile>,
    settingsRepo as unknown as Repository<FinanceSetting>,
    dataSource as unknown as DataSource,
    {} as FinanceDocumentNumberingService,
    { create: jest.fn() } as unknown as FinanceJournalEntryService,
    publisher,
  );

  return { service, publisher, invoicesRepo };
}

function makeTransactionManager(options: {
  invoice: FinanceInvoice;
  bill: FinanceBill;
  payment: FinancePayment;
  recurringProfile: FinanceRecurringProfile;
}) {
  const repos = new Map<unknown, any>([
    [
      FinanceInvoice,
      {
        findOne: jest.fn().mockResolvedValue(options.invoice),
        save: jest.fn(async (item: FinanceInvoice) => item),
        create: jest.fn((value: Partial<FinanceInvoice>) => ({
          id: options.invoice.id,
          ...value,
        })),
      },
    ],
    [
      FinanceInvoiceLine,
      {
        save: jest.fn(async (item: FinanceInvoiceLine) => item),
        create: jest.fn((value: Partial<FinanceInvoiceLine>) => value),
      },
    ],
    [
      FinanceBill,
      {
        findOne: jest.fn().mockResolvedValue(options.bill),
        save: jest.fn(async (item: FinanceBill) => item),
        create: jest.fn((value: Partial<FinanceBill>) => value),
      },
    ],
    [
      FinancePayment,
      {
        save: jest.fn(async (item: FinancePayment) => item),
      },
    ],
    [
      FinancePaymentAllocation,
      {
        create: jest.fn((value: Partial<FinancePaymentAllocation>) => value),
        save: jest.fn(async (item: FinancePaymentAllocation) => item),
      },
    ],
    [
      FinanceRecurringProfile,
      {
        save: jest.fn(async (item: FinanceRecurringProfile) => item),
      },
    ],
  ]);

  return {
    getRepository: jest.fn((entity) => repos.get(entity)),
  };
}

function makePublisher() {
  return {
    publishInvoiceIssued: jest.fn(),
    publishInvoicePaid: jest.fn(),
    publishPaymentReceived: jest.fn(),
    publishPaymentFailed: jest.fn(),
    publishBillPaid: jest.fn(),
    publishRecurringChargeCreated: jest.fn(),
  } as unknown as jest.Mocked<FinanceNotificationPublisher>;
}

function makeContext() {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-actor',
  };
}

function makeInvoice(overrides: Partial<FinanceInvoice> = {}): FinanceInvoice {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'invoice-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    customerId: null,
    sourceModule: null,
    sourceId: null,
    invoiceNumber: 'INV-00001',
    status: FinanceInvoiceStatus.Draft,
    currency: 'BRL',
    issueDate: null,
    dueDate: null,
    periodStart: null,
    periodEnd: null,
    subtotalAmount: '100.00',
    taxAmount: '0.00',
    discountAmount: '0.00',
    totalAmount: '100.00',
    paidAmount: '0.00',
    balanceDue: '100.00',
    terms: null,
    notes: null,
    issuedAt: null,
    paidAt: null,
    cancelledAt: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePayment(overrides: Partial<FinancePayment> = {}): FinancePayment {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'payment-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    direction: FinancePaymentDirection.Customer,
    status: FinancePaymentStatus.Completed,
    method: FinancePaymentMethod.Pix,
    contactId: null,
    bankAccountId: null,
    paymentDate: '2026-06-12',
    amount: '100.00',
    allocatedAmount: '0.00',
    currency: 'BRL',
    externalProvider: null,
    externalReference: null,
    description: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeBill(overrides: Partial<FinanceBill> = {}): FinanceBill {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'bill-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    vendorId: null,
    billNumber: 'BILL-00001',
    status: FinanceBillStatus.Open,
    currency: 'BRL',
    issueDate: null,
    dueDate: null,
    periodStart: null,
    periodEnd: null,
    subtotalAmount: '100.00',
    taxAmount: '0.00',
    totalAmount: '100.00',
    paidAmount: '0.00',
    balanceDue: '100.00',
    categoryId: null,
    costCenterId: null,
    notes: null,
    paidAt: null,
    cancelledAt: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeFinanceSettings(overrides: Partial<FinanceSetting> = {}): FinanceSetting {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'settings-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    baseCurrency: 'BRL',
    fiscalCountry: 'BR',
    fiscalLocalization: 'br_agency_simplified',
    defaultPaymentTermsDays: 7,
    invoiceTerms: null,
    pixEnabled: false,
    pixKey: null,
    autoGenerateRecurringInvoices: false,
    gracePeriodDays: 3,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeRecurringProfile(
  overrides: Partial<FinanceRecurringProfile> = {},
): FinanceRecurringProfile {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'recurring-profile-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    customerId: null,
    sourceModule: null,
    sourceId: null,
    name: 'Monthly retainer',
    status: FinanceRecurringProfileStatus.Active,
    interval: FinanceRecurringInterval.Monthly,
    amount: '100.00',
    currency: 'BRL',
    startDate: '2026-06-01',
    endDate: null,
    nextInvoiceDate: '2026-06-12',
    lastInvoiceDate: null,
    autoGenerateInvoice: true,
    categoryId: null,
    costCenterId: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
