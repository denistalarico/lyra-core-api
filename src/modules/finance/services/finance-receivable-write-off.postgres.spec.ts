import { randomUUID } from 'crypto';
import { DataSource, Repository, type FindOneOptions } from 'typeorm';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { CreateFinanceReceivableWriteOffs1799900000000 } from '../../../database/migrations/1799900000000-create-finance-receivable-write-offs';
import {
  FinanceAccount,
  FinanceBankAccount,
  FinanceBill,
  FinanceBillLine,
  FinanceBillRecurrence,
  FinanceInvoice,
  FinanceInvoiceLine,
  FinancePayment,
  FinancePaymentAllocation,
  FinancePeriod,
  FinanceRecurringProfile,
  FinanceSetting,
} from '../entities';
import { FinanceReceivableWriteOff } from '../entities/finance-receivable-write-off.entity';
import {
  FinanceAccountType,
  FinanceAllocationTargetType,
  FinanceInvoiceStatus,
  FinancePaymentDirection,
  FinancePaymentStatus,
  FinancePeriodStatus,
} from '../enums';
import { FinanceBillingService } from './finance-billing.service';
import { FinanceDocumentNumberingService } from './finance-document-numbering.service';
import { FinanceJournalEntryService } from './finance-journal-entry.service';
import { FinanceNotificationPublisher } from './finance-notification.publisher';
import { FinancePostingService } from './finance-posting.service';
import { FinanceReceivableWriteOffService } from './finance-receivable-write-off.service';
import { FinanceTeamPaymentReconciliationService } from './finance-team-payment-reconciliation.service';

const run = describePostgresIntegration();

run('Receivable write-offs (disposable PostgreSQL)', () => {
  const schema = `finance_loss_${randomUUID().replace(/-/g, '')}`;
  const ctx = {
    tenantId: randomUUID(),
    workspaceId: randomUUID(),
    userId: randomUUID(),
  };
  let admin: DataSource;
  let db: DataSource;
  let losses: FinanceReceivableWriteOffService;
  let billing: FinanceBillingService;
  let expenseAccountId: string;
  const posting = {
    postReceivableWriteOff: jest.fn(() =>
      Promise.resolve({ id: randomUUID() }),
    ),
    reverseReceivableWriteOff: jest.fn(() =>
      Promise.resolve({ id: randomUUID() }),
    ),
    postPaymentAllocationSettlement: () => Promise.resolve(null),
    reversePayment: () => Promise.resolve([]),
  };
  const options = {
    type: 'postgres' as const,
    host: process.env.AGENCY_DB_HOST,
    port: Number(process.env.AGENCY_DB_PORT),
    username: process.env.AGENCY_DB_USERNAME,
    password: process.env.AGENCY_DB_PASSWORD,
    database: process.env.AGENCY_DB_NAME,
  };

  beforeAll(async () => {
    admin = await new DataSource(options).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = await new DataSource({
      ...options,
      schema,
      extra: { options: `-c search_path=${schema},public` },
      synchronize: true,
      entities: [
        FinanceAccount,
        FinanceBankAccount,
        FinanceBill,
        FinanceBillLine,
        FinanceBillRecurrence,
        FinanceInvoice,
        FinanceInvoiceLine,
        FinancePayment,
        FinancePaymentAllocation,
        FinancePeriod,
        FinanceReceivableWriteOff,
        FinanceRecurringProfile,
        FinanceSetting,
      ],
    }).initialize();
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      // synchronize supplies the legacy tables; the migration itself must create
      // the loss table so its FK/CHECK/unique constraints are really exercised.
      await runner.query('DROP TABLE finance_receivable_write_offs');
      await new CreateFinanceReceivableWriteOffs1799900000000().up(runner);
      await new CreateFinanceReceivableWriteOffs1799900000000().down(runner);
      await new CreateFinanceReceivableWriteOffs1799900000000().up(runner);
    } finally {
      await runner.release();
    }
    expenseAccountId = (
      await db.getRepository(FinanceAccount).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        code: '6.99',
        name: 'Perdas com recebíveis',
        type: FinanceAccountType.Expense,
      })
    ).id;
    losses = new FinanceReceivableWriteOffService(
      db,
      posting as unknown as FinancePostingService,
    );
    billing = new FinanceBillingService(
      db.getRepository(FinanceInvoice),
      db.getRepository(FinanceInvoiceLine),
      db.getRepository(FinanceBill),
      db.getRepository(FinanceBillLine),
      db.getRepository(FinancePayment),
      db.getRepository(FinancePaymentAllocation),
      db.getRepository(FinanceBankAccount),
      db.getRepository(FinanceRecurringProfile),
      db.getRepository(FinanceBillRecurrence),
      db.getRepository(FinanceSetting),
      db,
      {} as FinanceDocumentNumberingService,
      {} as FinanceJournalEntryService,
      posting as unknown as FinancePostingService,
      {
        publishInvoicePaid: () => Promise.resolve(undefined),
        publishPaymentReceived: () => Promise.resolve(undefined),
      } as unknown as FinanceNotificationPublisher,
      {} as FinanceTeamPaymentReconciliationService,
    );
  }, 30000);

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  const newInvoice = async (paidAmount = '0.00') => {
    const invoice = await db.getRepository(FinanceInvoice).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      invoiceNumber: `INV-${randomUUID()}`,
      status:
        paidAmount === '0.00'
          ? FinanceInvoiceStatus.Issued
          : FinanceInvoiceStatus.PartiallyPaid,
      currency: 'BRL',
      issueDate: '2026-10-01',
      dueDate: '2026-10-10',
      totalAmount: '1000.00',
      paidAmount,
      balanceDue: (1000 - Number(paidAmount)).toFixed(2),
      metadata: {},
    });
    if (Number(paidAmount) > 0) {
      const payment = await db.getRepository(FinancePayment).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        direction: FinancePaymentDirection.Customer,
        status: FinancePaymentStatus.Completed,
        paymentDate: '2026-10-10',
        amount: paidAmount,
        allocatedAmount: paidAmount,
        currency: invoice.currency,
      });
      await db.getRepository(FinancePaymentAllocation).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        paymentId: payment.id,
        targetType: FinanceAllocationTargetType.Invoice,
        targetId: invoice.id,
        amount: paidAmount,
      });
    }
    return invoice;
  };
  const input = (amount = '700.00') => ({
    amount,
    writeOffDate: '2026-10-19',
    reason: 'Cobranças esgotadas e incobrabilidade comprovada',
    evidence: 'Processo de cobrança 2026/10',
    expenseAccountId,
    idempotencyKey: randomUUID(),
  });
  const invoiceAfter = (id: string) =>
    db.getRepository(FinanceInvoice).findOneByOrFail({ id });

  it('writes off the unpaid remainder without manufacturing cash or paid status', async () => {
    const invoice = await newInvoice('300.00');
    const paymentsBefore = await db.getRepository(FinancePayment).count();
    const loss = await losses.create(ctx, invoice.id, input());
    expect(await invoiceAfter(invoice.id)).toMatchObject({
      totalAmount: '1000.00',
      paidAmount: '300.00',
      writtenOffAmount: '700.00',
      balanceDue: '0.00',
      status: FinanceInvoiceStatus.PartiallyPaid,
      paidAt: null,
    });
    expect(loss).toMatchObject({
      amount: '700.00',
      currency: 'BRL',
      createdById: ctx.userId,
      status: 'active',
    });
    expect(loss.journalEntryId).toBeTruthy();
    expect(await db.getRepository(FinancePayment).count()).toBe(paymentsBefore);
  });

  it('reconciles completed allocations before granting a loss when legacy paid projection is stale', async () => {
    const invoice = await newInvoice('300.00');
    await db.getRepository(FinanceInvoice).update(invoice.id, {
      paidAmount: '0.00',
      balanceDue: '1000.00',
      status: FinanceInvoiceStatus.Issued,
    });
    await expect(
      losses.create(ctx, invoice.id, input('800.00')),
    ).rejects.toThrow();
    await losses.create(ctx, invoice.id, input('700.00'));
    expect(await invoiceAfter(invoice.id)).toMatchObject({
      paidAmount: '300.00',
      writtenOffAmount: '700.00',
      balanceDue: '0.00',
      status: FinanceInvoiceStatus.PartiallyPaid,
    });
  });

  it('serializes duplicate intent and rejects a changed payload for the same key', async () => {
    const invoice = await newInvoice();
    const dto = input('100.00');
    const [first, repeated] = await Promise.all([
      losses.create(ctx, invoice.id, dto),
      losses.create(ctx, invoice.id, dto),
    ]);
    expect(repeated.id).toBe(first.id);
    expect(await losses.list(ctx, invoice.id)).toHaveLength(1);
    expect(await invoiceAfter(invoice.id)).toMatchObject({
      writtenOffAmount: '100.00',
      balanceDue: '900.00',
    });
    await expect(
      losses.create(ctx, invoice.id, { ...dto, amount: '200.00' }),
    ).rejects.toThrow();
  });

  it.each(['0.00', '-1.00', '1000.01', '0.001', 'NaN'])(
    'rejects an invalid loss amount %s without changing the receivable',
    async (amount) => {
      const invoice = await newInvoice();
      await expect(
        losses.create(ctx, invoice.id, input(amount)),
      ).rejects.toThrow();
      expect(await losses.list(ctx, invoice.id)).toHaveLength(0);
      expect(await invoiceAfter(invoice.id)).toMatchObject({
        paidAmount: '0.00',
        writtenOffAmount: '0.00',
        balanceDue: '1000.00',
      });
    },
  );

  it('keeps a fully written-off unpaid invoice issued and accepts real money after reversal', async () => {
    const invoice = await newInvoice();
    const loss = await losses.create(ctx, invoice.id, input('1000.00'));
    expect(await invoiceAfter(invoice.id)).toMatchObject({
      paidAmount: '0.00',
      balanceDue: '0.00',
      writtenOffAmount: '1000.00',
      status: FinanceInvoiceStatus.Issued,
      paidAt: null,
    });
    await losses.reverse(ctx, invoice.id, loss.id, {
      reversalDate: '2026-10-20',
      reason: 'Recuperação do crédito',
    });
    const payment = await db.getRepository(FinancePayment).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      direction: FinancePaymentDirection.Customer,
      status: FinancePaymentStatus.Completed,
      paymentDate: '2026-10-20',
      amount: '1000.00',
      currency: 'BRL',
    });
    await billing.allocatePayment(ctx, payment.id, {
      targetType: FinanceAllocationTargetType.Invoice,
      targetId: invoice.id,
      amount: '1000.00',
    });
    expect(await invoiceAfter(invoice.id)).toMatchObject({
      paidAmount: '1000.00',
      writtenOffAmount: '0.00',
      balanceDue: '0.00',
      status: FinanceInvoiceStatus.Paid,
    });
    expect(await losses.list(ctx, invoice.id)).toHaveLength(1);
  });

  it('rejects an expense account from another workspace at the database boundary', async () => {
    const invoice = await newInvoice();
    const foreign = await db.getRepository(FinanceAccount).save({
      tenantId: ctx.tenantId,
      workspaceId: randomUUID(),
      code: '6.98',
      name: 'Other workspace expense',
      type: FinanceAccountType.Expense,
    });
    await expect(
      losses.create(ctx, invoice.id, {
        ...input(),
        expenseAccountId: foreign.id,
      }),
    ).rejects.toThrow();
    expect(await losses.list(ctx, invoice.id)).toHaveLength(0);
  });

  it('serializes competing losses so their sum never exceeds the available balance', async () => {
    const invoice = await newInvoice();
    const results = await Promise.allSettled([
      losses.create(ctx, invoice.id, input('700.00')),
      losses.create(ctx, invoice.id, input('700.00')),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await invoiceAfter(invoice.id)).toMatchObject({
      writtenOffAmount: '700.00',
      balanceDue: '300.00',
    });
  });

  it('serializes a customer allocation against a competing loss', async () => {
    const invoice = await newInvoice();
    const payment = await db.getRepository(FinancePayment).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      direction: FinancePaymentDirection.Customer,
      status: FinancePaymentStatus.Completed,
      paymentDate: '2026-10-19',
      amount: '700.00',
      currency: 'BRL',
    });
    const results = await Promise.allSettled([
      losses.create(ctx, invoice.id, input('700.00')),
      billing.allocatePayment(ctx, payment.id, {
        targetType: FinanceAllocationTargetType.Invoice,
        targetId: invoice.id,
        amount: '700.00',
      }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const result = await invoiceAfter(invoice.id);
    expect(Number(result.paidAmount) + Number(result.writtenOffAmount)).toBe(
      700,
    );
    expect(result.balanceDue).toBe('300.00');
  });

  it('preserves concurrent money received when a descriptive invoice edit started from a stale snapshot', async () => {
    const invoice = await newInvoice();
    await losses.create(ctx, invoice.id, input('100.00'));
    const payment = await db.getRepository(FinancePayment).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      direction: FinancePaymentDirection.Customer,
      status: FinancePaymentStatus.Completed,
      paymentDate: '2026-10-19',
      amount: '500.00',
      currency: 'BRL',
    });
    const invoicesRepo = (
      billing as unknown as { invoicesRepo: Repository<FinanceInvoice> }
    ).invoicesRepo;
    const findOne = (query: FindOneOptions<FinanceInvoice>) =>
      db.manager.findOne(FinanceInvoice, query);
    let announceSnapshot!: () => void;
    let releasePatch!: () => void;
    const snapshotReady = new Promise<void>((resolve) => {
      announceSnapshot = resolve;
    });
    const patchReleased = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    const snapshot = jest
      .spyOn(invoicesRepo, 'findOne')
      .mockImplementationOnce(async (query) => {
        const staleInvoice = await findOne(query);
        announceSnapshot();
        await patchReleased;
        return staleInvoice;
      });
    const patch = billing.updateInvoice(ctx, invoice.id, {
      notes: 'Observação editada simultaneamente ao recebimento',
    });
    try {
      await snapshotReady;
      try {
        await billing.allocatePayment(ctx, payment.id, {
          targetType: FinanceAllocationTargetType.Invoice,
          targetId: invoice.id,
          amount: '500.00',
        });
      } finally {
        releasePatch();
      }
      await patch;
    } finally {
      releasePatch();
      snapshot.mockRestore();
    }
    expect(await invoiceAfter(invoice.id)).toMatchObject({
      paidAmount: '500.00',
      writtenOffAmount: '100.00',
      balanceDue: '400.00',
      notes: 'Observação editada simultaneamente ao recebimento',
    });
    await expect(
      losses.create(ctx, invoice.id, input('500.00')),
    ).rejects.toThrow();
  });

  it('receives only the collectable remainder after a partial loss without marking the invoice fully paid', async () => {
    const invoice = await newInvoice();
    await losses.create(ctx, invoice.id, input('700.00'));
    const payment = await db.getRepository(FinancePayment).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      direction: FinancePaymentDirection.Customer,
      status: FinancePaymentStatus.Completed,
      paymentDate: '2026-10-20',
      amount: '300.00',
      currency: 'BRL',
    });
    await billing.allocatePayment(ctx, payment.id, {
      targetType: FinanceAllocationTargetType.Invoice,
      targetId: invoice.id,
      amount: '300.00',
    });
    expect(await invoiceAfter(invoice.id)).toMatchObject({
      paidAmount: '300.00',
      writtenOffAmount: '700.00',
      balanceDue: '0.00',
      paidAt: null,
      status: FinanceInvoiceStatus.PartiallyPaid,
    });
  });

  it.each([FinancePaymentStatus.Cancelled, FinancePaymentStatus.Refunded])(
    'rejects reactivation of an allocated %s payment after its reopened receivable was written off',
    async (voidStatus) => {
      const invoice = await newInvoice();
      const payment = await db.getRepository(FinancePayment).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        direction: FinancePaymentDirection.Customer,
        status: FinancePaymentStatus.Completed,
        paymentDate: '2026-10-19',
        amount: '300.00',
        currency: 'BRL',
      });
      await billing.allocatePayment(ctx, payment.id, {
        targetType: FinanceAllocationTargetType.Invoice,
        targetId: invoice.id,
        amount: '300.00',
      });
      await billing.updatePayment(ctx, payment.id, { status: voidStatus });
      expect(await invoiceAfter(invoice.id)).toMatchObject({
        paidAmount: '0.00',
        balanceDue: '1000.00',
      });
      await losses.create(ctx, invoice.id, input('1000.00'));
      await expect(
        billing.updatePayment(ctx, payment.id, {
          status: FinancePaymentStatus.Completed,
        }),
      ).rejects.toThrow();
      expect(
        await db
          .getRepository(FinancePayment)
          .findOneByOrFail({ id: payment.id }),
      ).toMatchObject({ status: voidStatus });
      expect(await invoiceAfter(invoice.id)).toMatchObject({
        paidAmount: '0.00',
        writtenOffAmount: '1000.00',
        balanceDue: '0.00',
        status: FinanceInvoiceStatus.Issued,
      });
      // An intermediate editable status must not reactivate retained historical
      // allocations either; legitimate pending transitions remove allocations.
      await billing.updatePayment(ctx, payment.id, {
        status: FinancePaymentStatus.Pending,
      });
      await expect(
        billing.updatePayment(ctx, payment.id, {
          status: FinancePaymentStatus.Completed,
        }),
      ).rejects.toThrow();
      expect(await invoiceAfter(invoice.id)).toMatchObject({
        paidAmount: '0.00',
        writtenOffAmount: '1000.00',
        balanceDue: '0.00',
      });
    },
  );

  it('recalculates a pending payment against active loss and reactivates only its collectable remainder', async () => {
    const invoice = await newInvoice();
    const payment = await db.getRepository(FinancePayment).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      direction: FinancePaymentDirection.Customer,
      status: FinancePaymentStatus.Completed,
      paymentDate: '2026-10-19',
      amount: '300.00',
      currency: 'BRL',
    });
    await billing.allocatePayment(ctx, payment.id, {
      targetType: FinanceAllocationTargetType.Invoice,
      targetId: invoice.id,
      amount: '300.00',
    });
    await losses.create(ctx, invoice.id, input('700.00'));
    await billing.updatePayment(ctx, payment.id, {
      status: FinancePaymentStatus.Pending,
    });
    expect(await invoiceAfter(invoice.id)).toMatchObject({
      paidAmount: '0.00',
      writtenOffAmount: '700.00',
      balanceDue: '300.00',
      status: FinanceInvoiceStatus.Issued,
    });
    expect(
      await db.getRepository(FinancePaymentAllocation).countBy({
        paymentId: payment.id,
      }),
    ).toBe(0);
    await billing.updatePayment(ctx, payment.id, {
      status: FinancePaymentStatus.Completed,
    });
    expect(await invoiceAfter(invoice.id)).toMatchObject({
      paidAmount: '300.00',
      writtenOffAmount: '700.00',
      balanceDue: '0.00',
      status: FinanceInvoiceStatus.PartiallyPaid,
      paidAt: null,
    });
    expect(
      await db.getRepository(FinancePaymentAllocation).countBy({
        paymentId: payment.id,
      }),
    ).toBe(1);
  });

  it('preserves immutable loss evidence when reversed and reopens only its receivable amount', async () => {
    const invoice = await newInvoice('300.00');
    const loss = await losses.create(ctx, invoice.id, input());
    const reverse = {
      reversalDate: '2026-10-20',
      reason: 'Cliente voltou a negociar',
    };
    await losses.reverse(ctx, invoice.id, loss.id, reverse);
    // Repeated reversal cannot reopen the same amount twice.
    await losses.reverse(ctx, invoice.id, loss.id, reverse);
    expect(await invoiceAfter(invoice.id)).toMatchObject({
      paidAmount: '300.00',
      writtenOffAmount: '0.00',
      balanceDue: '700.00',
      status: FinanceInvoiceStatus.PartiallyPaid,
    });
    const persisted = await db
      .getRepository(FinanceReceivableWriteOff)
      .findOneByOrFail({ id: loss.id });
    expect(persisted).toMatchObject({
      amount: '700.00',
      reason: input().reason,
      status: 'reversed',
      reversedById: ctx.userId,
      reversalDate: reverse.reversalDate,
      reversalReason: reverse.reason,
      journalEntryId: loss.journalEntryId,
    });
    expect(persisted.reversalEntryId).toBeTruthy();
    expect(persisted.reversedAt).toBeInstanceOf(Date);
  });

  it('isolates tenant and workspace across listing, creation and reversal', async () => {
    const invoice = await newInvoice();
    const loss = await losses.create(ctx, invoice.id, input());
    for (const foreign of [
      { ...ctx, tenantId: randomUUID() },
      { ...ctx, workspaceId: randomUUID() },
    ]) {
      await expect(
        losses.create(foreign, invoice.id, input()),
      ).rejects.toThrow();
      await expect(losses.list(foreign, invoice.id)).rejects.toThrow();
      await expect(
        losses.reverse(foreign, invoice.id, loss.id, {
          reversalDate: '2026-10-20',
          reason: 'Unauthorized',
        }),
      ).rejects.toThrow();
    }
    expect((await invoiceAfter(invoice.id)).writtenOffAmount).toBe('700.00');
  });

  it('searches a customer history with inclusive dates, status, stable pagination and tenant/workspace isolation', async () => {
    const customerId = randomUUID();
    const anotherCustomerId = randomUUID();
    const history: FinanceReceivableWriteOff[] = [];
    const invoices: FinanceInvoice[] = [];
    for (const writeOffDate of ['2026-10-10', '2026-10-15', '2026-10-20']) {
      const invoice = await newInvoice();
      await db.getRepository(FinanceInvoice).update(invoice.id, { customerId });
      invoices.push(invoice);
      history.push(
        await losses.create(ctx, invoice.id, {
          ...input('100.00'),
          writeOffDate,
        }),
      );
    }
    await losses.reverse(ctx, invoices[1].id, history[1].id, {
      reversalDate: '2026-10-21',
      reason: 'Correção da perda',
    });
    const otherInvoice = await newInvoice();
    await db.getRepository(FinanceInvoice).update(otherInvoice.id, {
      customerId: anotherCustomerId,
    });
    await losses.create(ctx, otherInvoice.id, input('100.00'));

    const first = await losses.search(ctx, { customerId, limit: 1, offset: 0 });
    expect(first).toMatchObject({ total: 3, limit: 1, offset: 0 });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      id: history[2].id,
      invoiceNumber: invoices[2].invoiceNumber,
      customerId,
    });
    const second = await losses.search(ctx, {
      customerId,
      limit: 1,
      offset: 1,
    });
    expect(second.items.map((item) => item.id)).toEqual([history[1].id]);
    const active = await losses.search(ctx, { customerId, status: 'active' });
    expect(active.total).toBe(2);
    expect(active.items.map((item) => item.id)).toEqual([
      history[2].id,
      history[0].id,
    ]);
    const date = await losses.search(ctx, {
      customerId,
      startDate: '2026-10-15',
      endDate: '2026-10-15',
      status: 'reversed',
    });
    expect(date.total).toBe(1);
    expect(date.items.map((item) => item.id)).toEqual([history[1].id]);
    for (const foreign of [
      { ...ctx, tenantId: randomUUID() },
      { ...ctx, workspaceId: randomUUID() },
    ]) {
      expect(await losses.search(foreign, { customerId })).toMatchObject({
        items: [],
        total: 0,
      });
    }
  });

  it.each([
    { startDate: '2026-02-30' },
    { endDate: '2026-10-19T10:00:00Z' },
    { startDate: '2026-10-20', endDate: '2026-10-19' },
  ])('rejects an invalid history date filter %j', async (query) => {
    await expect(losses.search(ctx, query)).rejects.toThrow();
  });

  it('rolls back a loss entirely when ledger posting fails', async () => {
    const invoice = await newInvoice();
    posting.postReceivableWriteOff.mockRejectedValueOnce(
      new Error('ledger unavailable'),
    );
    await expect(losses.create(ctx, invoice.id, input())).rejects.toThrow(
      'ledger unavailable',
    );
    expect(await losses.list(ctx, invoice.id)).toHaveLength(0);
    expect(await invoiceAfter(invoice.id)).toMatchObject({
      writtenOffAmount: '0.00',
      balanceDue: '1000.00',
    });
  });

  it('protects the original evidence against raw updates, deletion and migration rollback', async () => {
    const invoice = await newInvoice();
    const loss = await losses.create(ctx, invoice.id, input());
    await expect(
      db.getRepository(FinanceReceivableWriteOff).update(loss.id, {
        amount: '1.00',
        reason: 'Changed evidence',
      }),
    ).rejects.toThrow();
    await expect(
      db.getRepository(FinanceReceivableWriteOff).delete(loss.id),
    ).rejects.toThrow();
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await expect(
        new CreateFinanceReceivableWriteOffs1799900000000().down(runner),
      ).rejects.toThrow();
    } finally {
      await runner.release();
    }
    expect(await losses.list(ctx, invoice.id)).toHaveLength(1);
    expect((await invoiceAfter(invoice.id)).writtenOffAmount).toBe('700.00');
  });

  it('rejects a closed loss period and a locked reversal period without changing balances', async () => {
    const invoice = await newInvoice();
    await db.getRepository(FinanceInvoice).update(invoice.id, {
      issueDate: '2026-08-01',
    });
    await db.getRepository(FinancePeriod).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: 'Closed September',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      status: FinancePeriodStatus.Closed,
    });
    await expect(
      losses.create(ctx, invoice.id, {
        ...input(),
        writeOffDate: '2026-09-15',
      }),
    ).rejects.toThrow();
    const loss = await losses.create(ctx, invoice.id, input());
    await db.getRepository(FinancePeriod).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: 'Locked November',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      status: FinancePeriodStatus.Locked,
    });
    await expect(
      losses.reverse(ctx, invoice.id, loss.id, {
        reversalDate: '2026-11-15',
        reason: 'Locked date',
      }),
    ).rejects.toThrow();
    expect((await invoiceAfter(invoice.id)).writtenOffAmount).toBe('700.00');
  });

  it('guards legacy stale saves, cancellation and item mutations after an active loss', async () => {
    const invoice = await newInvoice();
    const line = await db.getRepository(FinanceInvoiceLine).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      invoiceId: invoice.id,
      description: 'Delivered service',
      quantity: '1',
      unitPrice: '1000',
      totalAmount: '1000',
    });
    await losses.create(ctx, invoice.id, input());
    // Simulate an instance fetched by the shared legacy backend before the loss.
    await expect(
      db.getRepository(FinanceInvoice).save(invoice),
    ).rejects.toThrow();
    await expect(
      db
        .getRepository(FinanceInvoice)
        .update(invoice.id, { status: FinanceInvoiceStatus.Cancelled }),
    ).rejects.toThrow();
    await expect(
      db
        .getRepository(FinanceInvoiceLine)
        .update(line.id, { totalAmount: '500.00' }),
    ).rejects.toThrow();
    await expect(
      db.getRepository(FinanceInvoiceLine).delete(line.id),
    ).rejects.toThrow();
    await expect(
      db.getRepository(FinanceInvoice).delete(invoice.id),
    ).rejects.toThrow();
    expect(await invoiceAfter(invoice.id)).toMatchObject({
      writtenOffAmount: '700.00',
      balanceDue: '300.00',
    });
  });
});
