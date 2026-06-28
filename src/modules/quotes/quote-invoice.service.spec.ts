import {
  QuoteInvoiceService,
  QUOTE_INVOICE_SOURCE_MODULE,
} from './quote-invoice.service';
import { FinanceCategoryType, FinanceCostCenterType } from '../finance/enums';

const TENANT = 'tenant-1';
const WORKSPACE = 'workspace-1';
const OTHER_TENANT = 'tenant-2';

type AnyRepo = {
  findOne: jest.Mock;
  find: jest.Mock;
};

function makeRepo(): AnyRepo {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
  };
}

function makeContext(overrides: Partial<{ tenantId: string; userId: string }> = {}) {
  return {
    tenantId: overrides.tenantId ?? TENANT,
    workspaceId: WORKSPACE,
    userId: overrides.userId ?? 'user-1',
  };
}

function makeQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quote-1',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    quoteNumber: 'Q-2026-00001',
    title: 'Proposta',
    currency: 'BRL',
    contactId: 'contact-1',
    companyContactId: 'company-1',
    opportunityId: null,
    validUntil: '2026-12-31',
    termsAndConditions: 'Termos',
    metadata: {},
    ...overrides,
  } as any;
}

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    quoteId: 'quote-1',
    salesItemId: 'sales-1',
    name: 'Serviço A',
    description: null,
    type: 'service',
    currency: 'BRL',
    quantity: 2,
    unitPriceCents: 10000,
    setupPriceCents: 0,
    recurringPriceCents: 0,
    discountCents: 0,
    taxCents: 0,
    recurrenceInterval: null,
    position: 0,
    metadata: {},
    ...overrides,
  } as any;
}

describe('QuoteInvoiceService', () => {
  let invoicesRepo: AnyRepo;
  let costCentersRepo: AnyRepo;
  let categoriesRepo: AnyRepo;
  let salesItemsRepo: AnyRepo;
  let clientsRepo: AnyRepo;
  let billing: { createInvoice: jest.Mock };
  let service: QuoteInvoiceService;

  beforeEach(() => {
    invoicesRepo = makeRepo();
    costCentersRepo = makeRepo();
    categoriesRepo = makeRepo();
    salesItemsRepo = makeRepo();
    clientsRepo = makeRepo();
    billing = {
      createInvoice: jest.fn(async (_ctx, dto) => ({
        id: 'invoice-1',
        invoiceNumber: 'INV-00001',
        status: 'draft',
        ...dto,
      })),
    };
    service = new QuoteInvoiceService(
      billing as any,
      invoicesRepo as any,
      costCentersRepo as any,
      categoriesRepo as any,
      salesItemsRepo as any,
      clientsRepo as any,
    );
  });

  it('creates a DRAFT invoice from an accepted quote, carrying the revenue category and source link', async () => {
    categoriesRepo.findOne.mockResolvedValue({
      id: 'cat-rev',
      type: FinanceCategoryType.Revenue,
    });
    const quote = makeQuote();
    const item = makeItem({
      metadata: { financials: { revenueCategory: 'cat-rev', costCenterStrategy: 'none' } },
    });

    const result = await service.getOrCreateDraftInvoiceForQuote(
      makeContext(),
      quote,
      [item],
    );

    expect(result.created).toBe(true);
    expect(billing.createInvoice).toHaveBeenCalledTimes(1);
    const dto = billing.createInvoice.mock.calls[0][1];
    expect(dto.sourceModule).toBe(QUOTE_INVOICE_SOURCE_MODULE);
    expect(dto.sourceId).toBe('quote-1');
    expect(dto.customerId).toBe('company-1');
    expect(dto.lines).toHaveLength(1);
    expect(dto.lines[0].categoryId).toBe('cat-rev');
    expect(dto.lines[0].unitPrice).toBe('100.00');
    expect(dto.lines[0].quantity).toBe('2');
    expect(dto.metadata.quoteId).toBe('quote-1');
    // The draft created here is never issued, so no ledger entry is produced.
    expect(result.invoice?.status).toBe('draft');
  });

  it('is idempotent: a quote already linked to an invoice is not billed twice', async () => {
    invoicesRepo.findOne.mockResolvedValue({
      id: 'invoice-existing',
      invoiceNumber: 'INV-00009',
    });

    const result = await service.getOrCreateDraftInvoiceForQuote(
      makeContext(),
      makeQuote(),
      [makeItem()],
    );

    expect(result.created).toBe(false);
    expect(result.invoice?.id).toBe('invoice-existing');
    expect(billing.createInvoice).not.toHaveBeenCalled();
  });

  it('maps a multi-item quote to multiple lines and records recurrence in metadata', async () => {
    const quote = makeQuote();
    const items = [
      makeItem({ id: 'item-1', name: 'Setup único', position: 0 }),
      makeItem({
        id: 'item-2',
        name: 'Plano mensal',
        position: 1,
        unitPriceCents: 0,
        recurringPriceCents: 50000,
        recurrenceInterval: 'monthly',
      }),
    ];

    const dtoResult = await service.getOrCreateDraftInvoiceForQuote(
      makeContext(),
      quote,
      items,
    );

    expect(dtoResult.created).toBe(true);
    const dto = billing.createInvoice.mock.calls[0][1];
    expect(dto.lines).toHaveLength(2);
    // Pure-recurring item is billed for its first period.
    const recurringLine = dto.lines.find((l: any) => l.description === 'Plano mensal');
    expect(recurringLine.unitPrice).toBe('500.00');
    expect(recurringLine.metadata.billedAs).toBe('recurring_first_period');
    expect(dto.metadata.recurrence.hasRecurring).toBe(true);
    expect(dto.metadata.recurrence.items).toHaveLength(1);
  });

  it('resolves the client cost center by bridging the quote contact to its client', async () => {
    // Quote references contact "company-1"; that contact belongs to client
    // "client-1"; the cost center is keyed by the client id.
    clientsRepo.find.mockResolvedValue([{ id: "client-1" }]);
    costCentersRepo.findOne.mockImplementation(async (opts: any) =>
      opts.where.relatedEntityId === "client-1" ? { id: "cc-client" } : null,
    );
    const item = makeItem({
      metadata: { financials: { costCenterStrategy: 'use_client_cost_center' } },
    });

    await service.getOrCreateDraftInvoiceForQuote(makeContext(), makeQuote(), [item]);

    const clientWhere = clientsRepo.find.mock.calls[0][0].where;
    expect(clientWhere.tenantId).toBe(TENANT);
    expect(clientWhere.workspaceId).toBe(WORKSPACE);
    const dto = billing.createInvoice.mock.calls[0][1];
    expect(dto.lines[0].costCenterId).toBe('cc-client');
  });

  it('falls back to a contact-keyed cost center (legacy) when no client mapping exists', async () => {
    clientsRepo.find.mockResolvedValue([]);
    costCentersRepo.findOne.mockImplementation(async (opts: any) =>
      opts.where.relatedEntityId === "company-1" ? { id: "cc-legacy" } : null,
    );
    const item = makeItem({
      metadata: { financials: { costCenterStrategy: 'use_client_cost_center' } },
    });

    await service.getOrCreateDraftInvoiceForQuote(makeContext(), makeQuote(), [item]);

    const dto = billing.createInvoice.mock.calls[0][1];
    expect(dto.lines[0].costCenterId).toBe('cc-legacy');
  });

  it('does not block invoice creation when no cost center is found', async () => {
    costCentersRepo.findOne.mockResolvedValue(null);
    const item = makeItem({
      metadata: { financials: { costCenterStrategy: 'use_client_cost_center' } },
    });

    const result = await service.getOrCreateDraftInvoiceForQuote(
      makeContext(),
      makeQuote(),
      [item],
    );

    expect(result.created).toBe(true);
    expect(billing.createInvoice.mock.calls[0][1].lines[0].costCenterId).toBeNull();
  });

  it('skips invoice creation when the quote has no items', async () => {
    const result = await service.getOrCreateDraftInvoiceForQuote(
      makeContext(),
      makeQuote(),
      [],
    );

    expect(result.skipped).toBe('no_items');
    expect(billing.createInvoice).not.toHaveBeenCalled();
  });

  it('scopes the idempotency lookup by tenant and workspace', async () => {
    await service.findInvoiceForQuote(makeContext({ tenantId: OTHER_TENANT }), 'quote-9');
    const where = invoicesRepo.findOne.mock.calls[0][0].where;
    expect(where).toMatchObject({
      tenantId: OTHER_TENANT,
      workspaceId: WORKSPACE,
      sourceModule: QUOTE_INVOICE_SOURCE_MODULE,
      sourceId: 'quote-9',
    });
  });

  it('falls back to the catalog item financials when the quote line has no snapshot', async () => {
    categoriesRepo.findOne.mockResolvedValue({
      id: 'cat-rev',
      type: FinanceCategoryType.Revenue,
    });
    salesItemsRepo.findOne.mockResolvedValue({
      id: 'sales-1',
      metadata: { revenueCategory: 'cat-rev' },
    });
    const item = makeItem({ metadata: {} });

    await service.getOrCreateDraftInvoiceForQuote(makeContext(), makeQuote(), [item]);

    expect(salesItemsRepo.findOne).toHaveBeenCalled();
    expect(billing.createInvoice.mock.calls[0][1].lines[0].categoryId).toBe('cat-rev');
  });

  it('builds a financial snapshot from a catalog item', async () => {
    salesItemsRepo.findOne.mockResolvedValue({
      id: 'sales-1',
      metadata: {
        revenueAccount: 'acc-rev',
        revenueCategory: 'cat-rev',
        costCenterStrategy: 'use_client_cost_center',
      },
    });

    const snapshot = await service.buildItemFinancialSnapshot(makeContext(), 'sales-1');
    expect(snapshot).toEqual({
      revenueAccount: 'acc-rev',
      revenueCategory: 'cat-rev',
      costCenterStrategy: 'use_client_cost_center',
    });
  });
});
