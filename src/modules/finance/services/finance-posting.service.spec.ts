import { DataSource, EntityManager } from 'typeorm';
import {
  FinanceAccount,
  FinanceBankAccount,
  FinanceBankTransfer,
  FinanceBill,
  FinanceBillLine,
  FinanceCategory,
  FinanceInvoice,
  FinanceInvoiceLine,
  FinanceJournal,
  FinanceJournalEntry,
  FinanceJournalEntryLine,
  FinancePayment,
  FinancePaymentAllocation,
} from '../entities';
import {
  FinanceAccountStatus,
  FinanceAccountType,
  FinanceAllocationTargetType,
  FinanceBankTransferStatus,
  FinanceCategoryType,
  FinanceJournalEntryLineType,
  FinanceJournalEntryStatus,
  FinanceJournalType,
  FinancePaymentDirection,
  FinancePaymentMethod,
  FinancePaymentStatus,
} from '../enums';
import { FinanceDocumentNumberingService } from './finance-document-numbering.service';
import { FinancePostingService } from './finance-posting.service';

const TENANT = 'tenant-1';
const WORKSPACE = 'workspace-1';

/**
 * Minimal in-memory store + fake EntityManager so the real posting logic
 * (account resolution, balancing, idempotency, reversal) runs end-to-end
 * without a database.
 */
class InMemoryStore {
  private seq = 0;
  readonly tables = new Map<unknown, any[]>();

  table(entity: unknown): any[] {
    let rows = this.tables.get(entity);
    if (!rows) {
      rows = [];
      this.tables.set(entity, rows);
    }
    return rows;
  }

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }
}

function matches(row: any, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

function makeRepo(store: InMemoryStore, entity: unknown, idPrefix: string) {
  const rows = store.table(entity);
  return {
    create: (value: any) => ({ ...value }),
    find: (options: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve(rows.filter((r) => (options.where ? matches(r, options.where) : true))),
    findOne: (options: { where?: Record<string, unknown> } = {}) =>
      Promise.resolve(rows.find((r) => (options.where ? matches(r, options.where) : true)) ?? null),
    save: (value: any) => {
      if (Array.isArray(value)) return Promise.resolve(value.map((v) => upsert(rows, store, idPrefix, v)));
      return Promise.resolve(upsert(rows, store, idPrefix, value));
    },
  };
}

function upsert(rows: any[], store: InMemoryStore, idPrefix: string, value: any) {
  if (!value.id) value.id = store.nextId(idPrefix);
  if (!value.createdAt) value.createdAt = new Date();
  const existing = rows.findIndex((r) => r.id === value.id);
  if (existing >= 0) rows[existing] = value;
  else rows.push(value);
  return value;
}

const ID_PREFIXES = new Map<unknown, string>([
  [FinanceAccount, 'account'],
  [FinanceJournal, 'journal'],
  [FinanceBankAccount, 'bank'],
  [FinanceCategory, 'category'],
  [FinanceInvoice, 'invoice'],
  [FinanceInvoiceLine, 'invoice-line'],
  [FinanceBill, 'bill'],
  [FinanceBillLine, 'bill-line'],
  [FinancePayment, 'payment'],
  [FinancePaymentAllocation, 'allocation'],
  [FinanceJournalEntry, 'entry'],
  [FinanceJournalEntryLine, 'entry-line'],
]);

function makeManager(store: InMemoryStore): EntityManager {
  return {
    getRepository: (entity: unknown) => makeRepo(store, entity, ID_PREFIXES.get(entity) ?? 'row'),
  } as unknown as EntityManager;
}

function makeService() {
  const store = new InMemoryStore();
  const manager = makeManager(store);

  let entryCounter = 0;
  const numbering = {
    generate: jest.fn().mockImplementation(() => {
      entryCounter += 1;
      return Promise.resolve(`JE-${String(entryCounter).padStart(4, '0')}`);
    }),
  } as unknown as FinanceDocumentNumberingService;

  const dataSource = {
    transaction: (fn: (m: EntityManager) => Promise<unknown>) => fn(manager),
  } as unknown as DataSource;

  const service = new FinancePostingService(dataSource, numbering);

  return { service, store, manager };
}

function ctx() {
  return { tenantId: TENANT, workspaceId: WORKSPACE, userId: 'user-actor' };
}

function seedChartOfAccounts(store: InMemoryStore) {
  const accounts: Array<Partial<FinanceAccount>> = [
    { code: '1.1.01', name: 'Caixa e Bancos', type: FinanceAccountType.Asset },
    { code: '1.1.02', name: 'Contas a Receber', type: FinanceAccountType.Asset },
    { code: '2.1.01', name: 'Contas a Pagar', type: FinanceAccountType.Liability },
    { code: '3.1.01', name: 'Receita de Serviços', type: FinanceAccountType.Revenue },
    { code: '5.1.01', name: 'Despesas Operacionais', type: FinanceAccountType.Expense },
  ];
  const table = store.table(FinanceAccount);
  for (const account of accounts) {
    table.push({ id: `account-${account.code}`, tenantId: TENANT, workspaceId: WORKSPACE, ...account });
  }
  store.table(FinanceJournal).push(
    { id: 'journal-sales', tenantId: TENANT, workspaceId: WORKSPACE, type: FinanceJournalType.Sales, active: true },
    { id: 'journal-purchase', tenantId: TENANT, workspaceId: WORKSPACE, type: FinanceJournalType.Purchase, active: true },
    { id: 'journal-bank', tenantId: TENANT, workspaceId: WORKSPACE, type: FinanceJournalType.Bank, active: true },
  );
}

function seedCurrentMasterDataChart(store: InMemoryStore) {
  const accounts: Array<Partial<FinanceAccount>> = [
    { code: '1.01.002', name: 'Banco conta corrente', type: FinanceAccountType.Asset },
    { code: '1.02.001', name: 'Clientes a receber', type: FinanceAccountType.Asset },
    { code: '2.01.001', name: 'Fornecedores a pagar', type: FinanceAccountType.Liability },
    { code: '4.01.013', name: 'Receita de Serviços', type: FinanceAccountType.Revenue },
    { code: '6.04.011', name: 'Outras despesas operacionais', type: FinanceAccountType.Expense },
  ];
  const table = store.table(FinanceAccount);
  for (const account of accounts) {
    table.push({ id: `account-${account.code}`, tenantId: TENANT, workspaceId: WORKSPACE, ...account });
  }
  store.table(FinanceJournal).push(
    { id: 'journal-sales', tenantId: TENANT, workspaceId: WORKSPACE, type: FinanceJournalType.Sales, active: true },
    { id: 'journal-purchase', tenantId: TENANT, workspaceId: WORKSPACE, type: FinanceJournalType.Purchase, active: true },
    { id: 'journal-bank', tenantId: TENANT, workspaceId: WORKSPACE, type: FinanceJournalType.Bank, active: true },
  );
}

function accountId(store: InMemoryStore, code: string): string {
  return store.table(FinanceAccount).find((a) => a.code === code)?.id;
}

function addInvoice(store: InMemoryStore, overrides: Partial<FinanceInvoice> = {}) {
  const invoice = {
    id: store.nextId('invoice'),
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    customerId: 'customer-1',
    invoiceNumber: 'INV-0001',
    issueDate: '2026-06-20',
    periodStart: '2026-06-01',
    totalAmount: '0.00',
    ...overrides,
  };
  store.table(FinanceInvoice).push(invoice);
  return invoice;
}

function addInvoiceLine(store: InMemoryStore, invoiceId: string, total: string, extra: Partial<FinanceInvoiceLine> = {}) {
  const line = {
    id: store.nextId('invoice-line'),
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    invoiceId,
    description: 'Serviço',
    totalAmount: total,
    categoryId: null,
    costCenterId: null,
    createdAt: new Date(Date.now() + store.table(FinanceInvoiceLine).length),
    ...extra,
  };
  store.table(FinanceInvoiceLine).push(line);
  return line;
}

function entriesOf(store: InMemoryStore) {
  return store.table(FinanceJournalEntry);
}

function linesOf(store: InMemoryStore, entryId: string) {
  return store.table(FinanceJournalEntryLine).filter((l) => l.journalEntryId === entryId);
}

function assertBalanced(store: InMemoryStore, entryId: string) {
  const lines = linesOf(store, entryId);
  const debit = lines
    .filter((l) => l.lineType === FinanceJournalEntryLineType.Debit)
    .reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0);
  const credit = lines
    .filter((l) => l.lineType === FinanceJournalEntryLineType.Credit)
    .reduce((s, l) => s + Math.round(Number(l.amount) * 100), 0);
  expect(debit).toBe(credit);
}

describe('FinancePostingService', () => {
  it('1. confirms an invoice with a single line (DEBIT receivable / CREDIT revenue)', async () => {
    const { service, store, manager } = makeService();
    seedChartOfAccounts(store);
    const invoice = addInvoice(store, { totalAmount: '100.00' });
    addInvoiceLine(store, invoice.id, '100.00');

    const entry = await service.postInvoiceConfirmed(ctx(), invoice.id, manager);

    expect(entry).not.toBeNull();
    expect(entry!.status).toBe(FinanceJournalEntryStatus.Posted);
    expect(entry!.eventType).toBe('invoice_confirmed');
    expect(entry!.journalId).toBe('journal-sales');
    const lines = linesOf(store, entry!.id);
    const debit = lines.find((l) => l.lineType === FinanceJournalEntryLineType.Debit);
    const credit = lines.find((l) => l.lineType === FinanceJournalEntryLineType.Credit);
    expect(debit.accountId).toBe(accountId(store, '1.1.02'));
    expect(debit.amount).toBe('100.00');
    expect(credit.accountId).toBe(accountId(store, '3.1.01'));
    expect(credit.amount).toBe('100.00');
    assertBalanced(store, entry!.id);
  });

  it('resolves the current master-data account anchors without setup/defaults codes', async () => {
    const { service, store, manager } = makeService();
    seedCurrentMasterDataChart(store);
    const invoice = addInvoice(store, { totalAmount: '100.00' });
    addInvoiceLine(store, invoice.id, '100.00');

    const entry = await service.postInvoiceConfirmed(ctx(), invoice.id, manager);

    const lines = linesOf(store, entry!.id);
    const debit = lines.find((l) => l.lineType === FinanceJournalEntryLineType.Debit);
    const credit = lines.find((l) => l.lineType === FinanceJournalEntryLineType.Credit);
    expect(debit.accountId).toBe(accountId(store, '1.02.001'));
    expect(credit.accountId).toBe(accountId(store, '4.01.013'));
    assertBalanced(store, entry!.id);
  });

  it('2. confirms an invoice with multiple lines and different accounts (grouped credits)', async () => {
    const { service, store, manager } = makeService();
    seedChartOfAccounts(store);
    // Custom revenue category pointing at a different revenue account.
    const altRevenue = { id: 'account-alt-rev', tenantId: TENANT, workspaceId: WORKSPACE, code: '3.1.02', name: 'Receita Recorrente', type: FinanceAccountType.Revenue };
    store.table(FinanceAccount).push(altRevenue);
    const category = { id: 'cat-rec', tenantId: TENANT, workspaceId: WORKSPACE, name: 'Recorrente', type: FinanceCategoryType.Revenue, accountId: altRevenue.id };
    store.table(FinanceCategory).push(category);

    const invoice = addInvoice(store, { totalAmount: '250.00' });
    addInvoiceLine(store, invoice.id, '100.00'); // default revenue
    addInvoiceLine(store, invoice.id, '60.00'); // default revenue (merges with first)
    addInvoiceLine(store, invoice.id, '90.00', { categoryId: category.id }); // alt revenue

    const entry = await service.postInvoiceConfirmed(ctx(), invoice.id, manager);

    const lines = linesOf(store, entry!.id);
    const credits = lines.filter((l) => l.lineType === FinanceJournalEntryLineType.Credit);
    const debit = lines.find((l) => l.lineType === FinanceJournalEntryLineType.Debit);
    expect(debit.amount).toBe('250.00');
    // Two distinct revenue accounts → two credit lines (default merged to 160).
    expect(credits).toHaveLength(2);
    const byAccount = Object.fromEntries(credits.map((c) => [c.accountId, c.amount]));
    expect(byAccount[accountId(store, '3.1.01')]).toBe('160.00');
    expect(byAccount[altRevenue.id]).toBe('90.00');
    assertBalanced(store, entry!.id);
  });

  it('uses the revenue account and sales journal inherited from the sales item', async () => {
    const { service, store, manager } = makeService();
    seedChartOfAccounts(store);
    store.table(FinanceAccount).push({
      id: 'account-product-revenue',
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      code: '3.1.99',
      name: 'Receita do produto',
      type: FinanceAccountType.Revenue,
      status: FinanceAccountStatus.Active,
    });
    store.table(FinanceJournal).push({
      id: 'journal-product-sales',
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      type: FinanceJournalType.Sales,
      active: true,
    });
    const invoice = addInvoice(store, { totalAmount: '100.00' });
    addInvoiceLine(store, invoice.id, '100.00', {
      metadata: {
        revenueAccountId: 'account-product-revenue',
        salesJournalId: 'journal-product-sales',
      },
    });

    const entry = await service.postInvoiceConfirmed(ctx(), invoice.id, manager);

    expect(entry?.journalId).toBe('journal-product-sales');
    const credit = linesOf(store, entry!.id).find(
      (line) => line.lineType === FinanceJournalEntryLineType.Credit,
    );
    expect(credit.accountId).toBe('account-product-revenue');
  });

  it('3. does not duplicate when an invoice is confirmed twice (idempotent)', async () => {
    const { service, store, manager } = makeService();
    seedChartOfAccounts(store);
    const invoice = addInvoice(store, { totalAmount: '100.00' });
    addInvoiceLine(store, invoice.id, '100.00');

    const first = await service.postInvoiceConfirmed(ctx(), invoice.id, manager);
    const second = await service.postInvoiceConfirmed(ctx(), invoice.id, manager);

    expect(first!.id).toBe(second!.id);
    expect(entriesOf(store).filter((e) => e.eventType === 'invoice_confirmed')).toHaveLength(1);
  });

  it('4 & 5. registers partial then final customer settlement (baixa) without touching revenue', async () => {
    const { service, store, manager } = makeService();
    seedChartOfAccounts(store);
    const bank = { id: 'bank-1', tenantId: TENANT, workspaceId: WORKSPACE, accountId: accountId(store, '1.1.01') };
    store.table(FinanceBankAccount).push(bank);

    const payment = makePayment({ direction: FinancePaymentDirection.Customer, amount: '100.00', bankAccountId: bank.id });
    const partial = makeAllocation(payment.id, '40.00');
    const final = makeAllocation(payment.id, '60.00');

    const e1 = await service.postPaymentAllocationSettlement(ctx(), payment, partial, manager);
    const e2 = await service.postPaymentAllocationSettlement(ctx(), payment, final, manager);

    expect(e1!.id).not.toBe(e2!.id);
    expect(e1!.eventType).toBe('customer_payment_completed');
    // DEBIT bank / CREDIT receivable, no revenue account involved.
    const l1 = linesOf(store, e1!.id);
    expect(l1.find((l) => l.lineType === FinanceJournalEntryLineType.Debit).accountId).toBe(accountId(store, '1.1.01'));
    expect(l1.find((l) => l.lineType === FinanceJournalEntryLineType.Credit).accountId).toBe(accountId(store, '1.1.02'));
    expect(Number(e1!.totalDebit)).toBe(40);
    expect(Number(e2!.totalDebit)).toBe(60);
    assertBalanced(store, e1!.id);
    assertBalanced(store, e2!.id);
    // Re-running the same allocation is idempotent.
    const again = await service.postPaymentAllocationSettlement(ctx(), payment, partial, manager);
    expect(again!.id).toBe(e1!.id);
  });

  it('6. confirms a bill with multiple lines (DEBIT cost per account / CREDIT payable)', async () => {
    const { service, store, manager } = makeService();
    seedChartOfAccounts(store);
    const bill = { id: 'bill-1', tenantId: TENANT, workspaceId: WORKSPACE, vendorId: 'vendor-1', billNumber: 'BILL-0001', issueDate: '2026-06-20', categoryId: null, costCenterId: null };
    store.table(FinanceBill).push(bill);
    store.table(FinanceBillLine).push(
      { id: 'bl-1', tenantId: TENANT, workspaceId: WORKSPACE, billId: bill.id, totalAmount: '70.00', categoryId: null, costCenterId: null, createdAt: new Date(1) },
      { id: 'bl-2', tenantId: TENANT, workspaceId: WORKSPACE, billId: bill.id, totalAmount: '30.00', categoryId: null, costCenterId: null, createdAt: new Date(2) },
    );

    const entry = await service.postBillConfirmed(ctx(), bill.id, manager);

    expect(entry!.eventType).toBe('bill_confirmed');
    expect(entry!.journalId).toBe('journal-purchase');
    const lines = linesOf(store, entry!.id);
    const credit = lines.find((l) => l.lineType === FinanceJournalEntryLineType.Credit);
    expect(credit.accountId).toBe(accountId(store, '2.1.01'));
    expect(credit.amount).toBe('100.00');
    expect(Number(entry!.totalDebit)).toBe(100);
    assertBalanced(store, entry!.id);
  });

  it('7. registers a supplier settlement (DEBIT payable / CREDIT bank)', async () => {
    const { service, store, manager } = makeService();
    seedChartOfAccounts(store);
    const bank = { id: 'bank-1', tenantId: TENANT, workspaceId: WORKSPACE, accountId: accountId(store, '1.1.01') };
    store.table(FinanceBankAccount).push(bank);
    const payment = makePayment({ direction: FinancePaymentDirection.Vendor, amount: '50.00', bankAccountId: bank.id });
    const allocation = makeAllocation(payment.id, '50.00', FinanceAllocationTargetType.Bill);

    const entry = await service.postPaymentAllocationSettlement(ctx(), payment, allocation, manager);

    expect(entry!.eventType).toBe('supplier_payment_completed');
    const lines = linesOf(store, entry!.id);
    expect(lines.find((l) => l.lineType === FinanceJournalEntryLineType.Debit).accountId).toBe(accountId(store, '2.1.01'));
    expect(lines.find((l) => l.lineType === FinanceJournalEntryLineType.Credit).accountId).toBe(accountId(store, '1.1.01'));
    assertBalanced(store, entry!.id);
  });

  it('8. reverses an invoice with a linked, balanced, swapped entry', async () => {
    const { service, store, manager } = makeService();
    seedChartOfAccounts(store);
    const invoice = addInvoice(store, { totalAmount: '100.00' });
    addInvoiceLine(store, invoice.id, '100.00');
    const original = await service.postInvoiceConfirmed(ctx(), invoice.id, manager);

    const reversals = await service.reverseInvoice(ctx(), invoice.id, manager);

    expect(reversals).toHaveLength(1);
    const reversal = reversals[0];
    expect(reversal.eventType).toBe('invoice_reversed');
    expect(reversal.reversesEntryId).toBe(original!.id);
    // Debit/credit swapped relative to the original.
    const origDebit = linesOf(store, original!.id).find((l) => l.lineType === FinanceJournalEntryLineType.Debit);
    const revCredit = linesOf(store, reversal.id).find((l) => l.lineType === FinanceJournalEntryLineType.Credit);
    expect(revCredit.accountId).toBe(origDebit.accountId);
    assertBalanced(store, reversal.id);
    // Reversing again does not duplicate.
    const second = await service.reverseInvoice(ctx(), invoice.id, manager);
    expect(second).toHaveLength(0);
  });

  it('9. reverses every settlement entry of a payment', async () => {
    const { service, store, manager } = makeService();
    seedChartOfAccounts(store);
    const bank = { id: 'bank-1', tenantId: TENANT, workspaceId: WORKSPACE, accountId: accountId(store, '1.1.01') };
    store.table(FinanceBankAccount).push(bank);
    const payment = makePayment({ direction: FinancePaymentDirection.Customer, amount: '100.00', bankAccountId: bank.id });
    await service.postPaymentAllocationSettlement(ctx(), payment, makeAllocation(payment.id, '40.00'), manager);
    await service.postPaymentAllocationSettlement(ctx(), payment, makeAllocation(payment.id, '60.00'), manager);

    const reversals = await service.reversePayment(ctx(), payment, manager);

    expect(reversals).toHaveLength(2);
    reversals.forEach((r) => {
      expect(r.eventType).toBe('payment_reversed');
      assertBalanced(store, r.id);
    });
    // Net effect is zero: total debit == total credit across all payment entries.
    const all = entriesOf(store).filter((e) => e.sourceModule === 'payment');
    const debit = all.reduce((s, e) => s + Number(e.totalDebit), 0);
    const credit = all.reduce((s, e) => s + Number(e.totalCredit), 0);
    expect(debit).toBe(credit);
  });

  it('posts and reverses a bank transfer without touching revenue or expense', async () => {
    const { service, store, manager } = makeService();
    seedChartOfAccounts(store);
    store.table(FinanceAccount).push({
      id: 'account-card-liability',
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      code: '2.1.02',
      name: 'Cartões de crédito a pagar',
      type: FinanceAccountType.Liability,
    });
    store.table(FinanceBankAccount).push(
      {
        id: 'bank-checking',
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        name: 'Conta corrente',
        accountId: accountId(store, '1.1.01'),
        active: true,
      },
      {
        id: 'bank-card',
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        name: 'Cartão empresarial',
        accountId: 'account-card-liability',
        active: true,
      },
    );
    const transfer = {
      id: 'transfer-1',
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      fromBankAccountId: 'bank-checking',
      toBankAccountId: 'bank-card',
      transferDate: '2026-06-25',
      amount: '250.00',
      currency: 'BRL',
      description: 'Pagamento da fatura do cartão',
      status: FinanceBankTransferStatus.Completed,
    } as FinanceBankTransfer;

    const entry = await service.postBankTransfer(ctx(), transfer, manager);

    expect(entry.eventType).toBe('bank_transfer_completed');
    expect(entry.sourceModule).toBe('bank_transfer');
    const lines = linesOf(store, entry.id);
    expect(lines.find((line) => line.lineType === FinanceJournalEntryLineType.Debit).accountId).toBe('account-card-liability');
    expect(lines.find((line) => line.lineType === FinanceJournalEntryLineType.Credit).accountId).toBe(accountId(store, '1.1.01'));
    expect(
      lines.some((line) =>
        [FinanceAccountType.Revenue, FinanceAccountType.Expense].includes(
          store.table(FinanceAccount).find((account) => account.id === line.accountId)?.type,
        ),
      ),
    ).toBe(false);
    assertBalanced(store, entry.id);

    const reversals = await service.reverseBankTransfer(ctx(), transfer.id, manager);
    expect(reversals).toHaveLength(1);
    expect(reversals[0].eventType).toBe('bank_transfer_reversed');
    expect(reversals[0].reversesEntryId).toBe(entry.id);
    assertBalanced(store, reversals[0].id);
  });

  it('10. isolates posting by tenant/workspace (no cross-tenant entries or duplicates)', async () => {
    const { service, store, manager } = makeService();
    seedChartOfAccounts(store);
    const invoice = addInvoice(store, { totalAmount: '100.00' });
    addInvoiceLine(store, invoice.id, '100.00');

    await service.postInvoiceConfirmed(ctx(), invoice.id, manager);
    // Different workspace: idempotency key differs, but the invoice does not
    // belong to it → nothing is posted.
    const otherCtx = { tenantId: TENANT, workspaceId: 'workspace-2', userId: 'user-actor' };
    const other = await service.postInvoiceConfirmed(otherCtx, invoice.id, manager);

    expect(other).toBeNull();
    expect(entriesOf(store)).toHaveLength(1);
    expect(entriesOf(store)[0].workspaceId).toBe(WORKSPACE);
  });

  it('11. throws a clear error (keeping debit/credit balanced) when a system account is missing', async () => {
    const { service, store, manager } = makeService();
    // No chart of accounts seeded.
    const invoice = addInvoice(store, { totalAmount: '100.00' });
    addInvoiceLine(store, invoice.id, '100.00');

    await expect(service.postInvoiceConfirmed(ctx(), invoice.id, manager)).rejects.toThrow(
      /Contas a Receber/,
    );
    expect(entriesOf(store)).toHaveLength(0);
  });

  it('does not post anything for a draft invoice with no lines', async () => {
    const { service, store, manager } = makeService();
    seedChartOfAccounts(store);
    const invoice = addInvoice(store, { totalAmount: '0.00' });

    const entry = await service.postInvoiceConfirmed(ctx(), invoice.id, manager);

    expect(entry).toBeNull();
    expect(entriesOf(store)).toHaveLength(0);
  });
});

function makePayment(overrides: Partial<FinancePayment> = {}): FinancePayment {
  return {
    id: 'payment-1',
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    direction: FinancePaymentDirection.Customer,
    status: FinancePaymentStatus.Completed,
    method: FinancePaymentMethod.Pix,
    contactId: 'customer-1',
    bankAccountId: null,
    paymentDate: '2026-06-21',
    amount: '100.00',
    allocatedAmount: '0.00',
    currency: 'BRL',
    externalProvider: null,
    externalReference: null,
    description: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as FinancePayment;
}

let allocationSeq = 0;
function makeAllocation(
  paymentId: string,
  amount: string,
  targetType: FinanceAllocationTargetType = FinanceAllocationTargetType.Invoice,
): FinancePaymentAllocation {
  allocationSeq += 1;
  return {
    id: `allocation-${allocationSeq}`,
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    paymentId,
    targetType,
    targetId: 'target-1',
    amount,
    metadata: {},
    createdAt: new Date(),
  } as FinancePaymentAllocation;
}
