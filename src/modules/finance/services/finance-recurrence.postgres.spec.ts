import { randomUUID } from 'crypto';
import * as contractCalendar from '../../contracts/contract-term';
import { DataSource } from 'typeorm';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import {
  FinanceBill,
  FinanceBillLine,
  FinanceBillRecurrence,
  FinanceInvoice,
  FinanceInvoiceLine,
  FinancePayment,
  FinancePaymentAllocation,
  FinanceBankAccount,
  FinanceRecurringProfile,
  FinanceSetting,
} from '../entities';
import {
  FinanceBillRecurrenceFrequency,
  FinanceBillRecurrenceStatus,
  FinanceBillStatus,
  FinanceRecurringInterval,
  FinanceRecurringProfileStatus,
} from '../enums';
import { FinanceDocumentRecurrenceService } from './finance-document-recurrence.service';
import { FinanceBillingService } from './finance-billing.service';
import { FinanceDocumentNumberingService } from './finance-document-numbering.service';
import { FinanceJournalEntryService } from './finance-journal-entry.service';
import { FinancePostingService } from './finance-posting.service';
import { FinanceNotificationPublisher } from './finance-notification.publisher';
import { FinanceTeamPaymentReconciliationService } from './finance-team-payment-reconciliation.service';

const run = describePostgresIntegration();
run('Finance recurring document transactions (disposable PostgreSQL)', () => {
  let db: DataSource;
  let admin: DataSource;
  let billing: FinanceBillingService;
  const schema = `finance_recurrence_${randomUUID().replace(/-/g, '')}`;
  const ctx = {
    tenantId: randomUUID(),
    workspaceId: randomUUID(),
    userId: null,
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
      synchronize: true,
      entities: [
        FinanceBill,
        FinanceBillLine,
        FinanceBillRecurrence,
        FinanceInvoice,
        FinanceInvoiceLine,
        FinancePayment,
        FinancePaymentAllocation,
        FinanceBankAccount,
        FinanceRecurringProfile,
        FinanceSetting,
      ],
    }).initialize();
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
      {
        generate: () => Promise.resolve(`BILL-${randomUUID()}`),
      } as unknown as FinanceDocumentNumberingService,
      {} as FinanceJournalEntryService,
      {
        reverseBill: () => Promise.resolve([]),
        postInvoiceConfirmed: () => Promise.resolve(null),
      } as unknown as FinancePostingService,
      {} as FinanceNotificationPublisher,
      {} as FinanceTeamPaymentReconciliationService,
      new FinanceDocumentRecurrenceService(db),
    );
    await db.getRepository(FinanceSetting).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      baseCurrency: 'BRL',
    });
  }, 30000);
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });
  it('serializes competing bill generators and commits one occurrence with its cursor', async () => {
    const recurrence = await db.getRepository(FinanceBillRecurrence).save({
      createdAt: new Date('2025-01-01T12:00:00Z'),
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: 'Aluguel',
      currency: 'BRL',
      amount: '100',
      status: FinanceBillRecurrenceStatus.Active,
      active: true,
      frequency: FinanceBillRecurrenceFrequency.Monthly,
      intervalCount: 1,
      startDate: '2026-01-01',
      nextGenerationDate: '2026-02-01',
      generationDay: 1,
      dueDay: 10,
      generateAsStatus: FinanceBillStatus.Draft,
      lineTemplate: [
        {
          description: 'Aluguel',
          quantity: '1',
          unitPrice: '100',
          taxAmount: '0',
          categoryId: null,
          costCenterId: null,
          metadata: { expenseAccountId: randomUUID() },
        },
      ],
      metadata: { competenceMode: 'previous' },
    });
    const stale = await db
      .getRepository(FinanceBillRecurrence)
      .findOneByOrFail({ id: recurrence.id });
    const settings = await db
      .getRepository(FinanceSetting)
      .findOneByOrFail({ tenantId: ctx.tenantId });
    // The same scheduled intent races, as happens across replicas or manual+cron.
    const generate = (profile: FinanceBillRecurrence) =>
      (
        billing as unknown as {
          generateBillForRecurrence: (
            context: typeof ctx,
            profile: FinanceBillRecurrence,
            date: string,
            settings: FinanceSetting,
          ) => Promise<{ skipped: boolean }>;
        }
      ).generateBillForRecurrence(ctx, profile, '2026-02-01', settings);
    const results = await Promise.all([generate(recurrence), generate(stale)]);
    expect(results.filter((result) => !result.skipped)).toHaveLength(1);
    const bills = await db.getRepository(FinanceBill).find();
    expect(bills).toHaveLength(1);
    expect(bills[0].periodStart).toBe('2026-01-01');
    expect(bills[0].dueDate).toBe('2026-02-10');
    expect(
      (
        await db
          .getRepository(FinanceBillRecurrence)
          .findOneByOrFail({ id: recurrence.id })
      ).nextGenerationDate,
    ).toBe('2026-03-01');
  });
  it('reads generated invoices after commit, copying source prices, discount and dimensions', async () => {
    const profile = await db.getRepository(FinanceRecurringProfile).save({
      createdAt: new Date('2025-01-01T12:00:00Z'),
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: 'Contrato',
      status: FinanceRecurringProfileStatus.Active,
      interval: FinanceRecurringInterval.Monthly,
      amount: '175',
      currency: 'BRL',
      startDate: '2026-01-01',
      nextInvoiceDate: '2026-02-28',
      autoGenerateInvoice: true,
      metadata: {
        generationDay: 31,
        dueDay: 31,
        competenceMode: 'previous',
        document: {
          terms: 'Condições originais',
          metadata: { internalName: 'Mensalidade', journalId: randomUUID() },
        },
        lines: [
          {
            description: 'Serviço contratado',
            quantity: '2',
            unitPrice: '100',
            discountAmount: '25',
            taxAmount: '0',
            metadata: { revenueAccountId: randomUUID() },
          },
        ],
      },
    });
    const result = await billing.generateInvoiceFromRecurringProfile(
      ctx,
      profile.id,
    );
    expect(result.invoice.lines).toHaveLength(1);
    expect(result.invoice.lines[0].discountAmount).toBe('25.00');
    expect(result.invoice.totalAmount).toBe('175.00');
    expect(result.invoice.dueDate).toBe('2026-02-28');
    expect(result.recurringProfile.nextInvoiceDate).toBe('2026-03-31');
    expect(result.invoice.metadata.internalName).toBe('Mensalidade');
    await expect(
      billing.generateInvoiceFromRecurringProfile(
        { ...ctx, tenantId: randomUUID() },
        profile.id,
      ),
    ).rejects.toThrow('not found');
  });
  it('reschedules the pending issue day without enabling other workspace profiles', async () => {
    const service = new FinanceDocumentRecurrenceService(db);
    const invoice = await db.getRepository(FinanceInvoice).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      invoiceNumber: '',
      currency: 'BRL',
      issueDate: '2026-10-01',
      metadata: {},
    });
    await db.getRepository(FinanceInvoiceLine).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      invoiceId: invoice.id,
      description: 'Contract item',
      quantity: '1',
      unitPrice: '100',
      totalAmount: '100',
      metadata: {},
    });
    await db
      .getRepository(FinanceInvoice)
      .update(invoice.id, { totalAmount: '100' });
    const config = {
      enabled: true,
      generationDay: 5,
      dueDay: 10,
      competenceMode: 'current' as const,
    };
    const first = await service.configure(ctx, 'invoice', invoice.id, config);
    const second = await service.configure(ctx, 'invoice', invoice.id, {
      ...config,
      generationDay: 20,
    });
    expect(second.profileId).toBe(first.profileId);
    expect(
      (
        await db
          .getRepository(FinanceRecurringProfile)
          .findOneByOrFail({ id: first.profileId })
      ).nextInvoiceDate,
    ).toBe('2026-11-20');
    expect(
      (
        await db
          .getRepository(FinanceSetting)
          .findOneByOrFail({ tenantId: ctx.tenantId })
      ).autoGenerateRecurringInvoices,
    ).toBe(false);
  });

  it('keeps occurrence identity independent of changing competence and due day', async () => {
    const profile = await db.getRepository(FinanceRecurringProfile).save({
      createdAt: new Date('2025-01-01T12:00:00Z'),
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      sourceModule: 'finance_invoice',
      name: 'Mutable due day',
      status: FinanceRecurringProfileStatus.Active,
      interval: FinanceRecurringInterval.Monthly,
      amount: '100',
      currency: 'BRL',
      startDate: '2026-11-20',
      nextInvoiceDate: '2026-11-20',
      autoGenerateInvoice: true,
      metadata: { generationDay: 20, dueDay: 10, competenceMode: 'current' },
    });
    const first = await billing.generateInvoiceFromRecurringProfile(
      ctx,
      profile.id,
    );
    expect(first.invoice.periodStart).toBe('2026-12-01');
    await db.getRepository(FinanceRecurringProfile).update(profile.id, {
      metadata: { generationDay: 20, dueDay: 25, competenceMode: 'current' },
    });
    const second = await billing.generateInvoiceFromRecurringProfile(
      ctx,
      profile.id,
    );
    expect(second.invoice.periodStart).toBe('2026-12-01');
    expect(second.invoice.id).not.toBe(first.invoice.id);
    expect(second.recurringProfile.nextInvoiceDate).toBe('2027-01-20');
  });

  it('rechecks automatic generation under the profile lock', async () => {
    const profile = await db.getRepository(FinanceRecurringProfile).save({
      createdAt: new Date('2025-01-01T12:00:00Z'),
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: 'Paused automation',
      status: FinanceRecurringProfileStatus.Active,
      interval: FinanceRecurringInterval.Monthly,
      amount: '100',
      currency: 'BRL',
      startDate: '2026-01-01',
      nextInvoiceDate: '2026-02-01',
      autoGenerateInvoice: false,
    });
    const automaticService = billing as unknown as {
      generateInvoiceForProfile: (
        context: typeof ctx,
        profile: FinanceRecurringProfile,
        date: string,
        automatic: boolean,
      ) => Promise<unknown>;
    };
    await expect(
      automaticService.generateInvoiceForProfile(
        ctx,
        profile,
        '2026-02-01',
        true,
      ),
    ).rejects.toThrow('inativa');
    expect(
      (
        await db
          .getRepository(FinanceRecurringProfile)
          .findOneByOrFail({ id: profile.id })
      ).nextInvoiceDate,
    ).toBe('2026-02-01');
  });

  it('clears deleted bill links atomically without rewinding the recurrence cursor', async () => {
    const bill = await db.getRepository(FinanceBill).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      billNumber: '',
      currency: 'BRL',
      status: FinanceBillStatus.Draft,
    });
    const profile = await db.getRepository(FinanceBillRecurrence).save({
      createdAt: new Date('2025-01-01T12:00:00Z'),
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: 'Delete pointers',
      currency: 'BRL',
      amount: '100',
      status: FinanceBillRecurrenceStatus.Active,
      active: true,
      frequency: FinanceBillRecurrenceFrequency.Monthly,
      intervalCount: 1,
      startDate: '2026-01-01',
      nextGenerationDate: '2026-04-01',
      sourceBillId: bill.id,
      lastGeneratedBillId: bill.id,
      lastGeneratedAt: new Date(),
      lineTemplate: [],
      metadata: {},
    });
    await billing.deleteBill(ctx, bill.id);
    const result = await db
      .getRepository(FinanceBillRecurrence)
      .findOneByOrFail({ id: profile.id });
    expect(result.sourceBillId).toBeNull();
    expect(result.lastGeneratedBillId).toBeNull();
    expect(result.nextGenerationDate).toBe('2026-04-01');
  });

  it('deduplicates legacy invoice occurrences without the new metadata marker', async () => {
    const profile = await db.getRepository(FinanceRecurringProfile).save({
      createdAt: new Date('2025-01-01T12:00:00Z'),
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: 'Legacy',
      status: FinanceRecurringProfileStatus.Active,
      interval: FinanceRecurringInterval.Monthly,
      amount: '100',
      currency: 'BRL',
      startDate: '2026-01-10',
      nextInvoiceDate: '2026-02-10',
      autoGenerateInvoice: true,
    });
    const legacy = await db.getRepository(FinanceInvoice).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      sourceModule: 'finance_recurring_profile',
      sourceId: profile.id,
      issueDate: '2026-02-10',
      periodStart: '2026-02-10',
      invoiceNumber: '',
      currency: 'BRL',
      metadata: {},
    });
    const before = await db.getRepository(FinanceInvoice).count();
    const result = await billing.generateInvoiceFromRecurringProfile(
      ctx,
      profile.id,
    );
    expect(result.skipped).toBe(true);
    expect(result.invoice.id).toBe(legacy.id);
    expect(await db.getRepository(FinanceInvoice).count()).toBe(before);
    expect(result.recurringProfile.nextInvoiceDate).toBe('2026-03-10');
  });

  it('copies saved item edits into future invoices without resuming a paused profile', async () => {
    const service = new FinanceDocumentRecurrenceService(db);
    const invoice = await db.getRepository(FinanceInvoice).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      invoiceNumber: '',
      currency: 'BRL',
      issueDate: '2026-10-01',
      totalAmount: '100',
      metadata: {},
    });
    const line = await db.getRepository(FinanceInvoiceLine).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      invoiceId: invoice.id,
      description: 'Retainer',
      quantity: '1',
      unitPrice: '100',
      totalAmount: '100',
      metadata: {},
    });
    const configured = await service.configure(ctx, 'invoice', invoice.id, {
      enabled: true,
      generationDay: 1,
      dueDay: 10,
      competenceMode: 'current',
    });
    await db
      .getRepository(FinanceRecurringProfile)
      .update(configured.profileId, {
        status: FinanceRecurringProfileStatus.Paused,
      });
    await billing.updateInvoiceLine(ctx, invoice.id, line.id, {
      unitPrice: '150',
      metadata: { revenueAccountId: randomUUID() },
    });
    const profile = await db
      .getRepository(FinanceRecurringProfile)
      .findOneByOrFail({ id: configured.profileId });
    expect(profile.amount).toBe('150.00');
    expect(profile.status).toBe(FinanceRecurringProfileStatus.Paused);
    const template = profile.metadata.lines as Array<{
      unitPrice: string;
      metadata: { revenueAccountId: unknown };
    }>;
    expect(template).toHaveLength(1);
    expect(template[0].unitPrice).toBe('150.00');
    expect(typeof template[0].metadata.revenueAccountId).toBe('string');
  });

  it('emits an automatically issued invoice with its number and payment forecast', async () => {
    const profile = await db.getRepository(FinanceRecurringProfile).save({
      createdAt: new Date('2025-01-01T12:00:00Z'),
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: 'Issued monthly',
      status: FinanceRecurringProfileStatus.Active,
      interval: FinanceRecurringInterval.Monthly,
      amount: '100',
      currency: 'BRL',
      startDate: '2026-01-01',
      nextInvoiceDate: '2026-02-01',
      autoGenerateInvoice: true,
      metadata: { generateAsStatus: 'issued' },
    });
    const result = await billing.generateInvoiceFromRecurringProfile(
      ctx,
      profile.id,
    );
    expect(result.invoice.status).toBe('issued');
    expect(result.invoice.invoiceNumber).not.toBe('');
    expect(result.invoice.issuedAt).toBeInstanceOf(Date);
    const forecast = await db.getRepository(FinancePayment).find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });
    expect(
      forecast.some(
        (payment) => payment.metadata.sourceId === result.invoice.id,
      ),
    ).toBe(true);
  });

  it('rolls back a failed occurrence without advancing its profile', async () => {
    const profile = await db.getRepository(FinanceBillRecurrence).save({
      createdAt: new Date('2025-01-01T12:00:00Z'),
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      name: 'Broken',
      amount: '1',
      currency: 'BRL',
      status: FinanceBillRecurrenceStatus.Active,
      active: true,
      frequency: FinanceBillRecurrenceFrequency.Monthly,
      startDate: '2026-01-01',
      nextGenerationDate: '2026-02-01',
      intervalCount: 1,
      lineTemplate: [
        {
          description: 'x'.repeat(300),
          quantity: '1',
          unitPrice: '1',
          taxAmount: '0',
          categoryId: null,
          costCenterId: null,
        },
      ],
      metadata: {},
    });
    const before = await db.getRepository(FinanceBill).count();
    await expect(
      billing.generateBillFromRecurrence(ctx, profile.id),
    ).rejects.toThrow();
    expect(await db.getRepository(FinanceBill).count()).toBe(before);
    expect(
      (
        await db
          .getRepository(FinanceBillRecurrence)
          .findOneByOrFail({ id: profile.id })
      ).nextGenerationDate,
    ).toBe('2026-02-01');
  });
  it('logically deletes a source recurrence, preserves generated history and reuses its pending cursor on explicit reactivation', async () => {
    const service = new FinanceDocumentRecurrenceService(db);
    const invoice = await db.getRepository(FinanceInvoice).save({
      ...ctx,
      invoiceNumber: '',
      currency: 'BRL',
      issueDate: '2026-10-01',
      totalAmount: '100',
      metadata: {},
    });
    await db.getRepository(FinanceInvoiceLine).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      invoiceId: invoice.id,
      description: 'Retainer',
      quantity: '1',
      unitPrice: '100',
      totalAmount: '100',
      metadata: {},
    });
    const config = {
      enabled: true,
      generationDay: 1,
      dueDay: 10,
      competenceMode: 'current' as const,
      generateAsStatus: 'draft' as const,
    };
    const configured = await service.configure(
      ctx,
      'invoice',
      invoice.id,
      config,
    );
    const generated = await billing.generateInvoiceFromRecurringProfile(
      ctx,
      configured.profileId,
    );
    const pending = generated.recurringProfile.nextInvoiceDate;
    await service.delete(ctx, 'invoice', configured.profileId);
    expect(
      (await billing.listRecurringProfiles(ctx)).some(
        (row) => row.id === configured.profileId,
      ),
    ).toBe(false);
    expect((await billing.getInvoice(ctx, generated.invoice.id)).id).toBe(
      generated.invoice.id,
    );
    expect(
      (await billing.getInvoice(ctx, invoice.id)).metadata.isRecurring,
    ).toBe(false);
    await expect(
      billing.generateInvoiceFromRecurringProfile(ctx, configured.profileId),
    ).rejects.toThrow('active');
    await service.configure(ctx, 'invoice', invoice.id, {
      ...config,
      enabled: false,
    });
    expect(
      (await billing.listRecurringProfiles(ctx)).some(
        (row) => row.id === configured.profileId,
      ),
    ).toBe(false);
    const restored = await service.configure(
      ctx,
      'invoice',
      invoice.id,
      config,
    );
    expect(restored.profileId).toBe(configured.profileId);
    const profile = await db
      .getRepository(FinanceRecurringProfile)
      .findOneByOrFail({ id: restored.profileId });
    expect(profile.metadata.deletedAt).toBeNull();
    expect(profile.nextInvoiceDate).toBe(pending);
  });
  it('repairs a legacy invoice cursor before registration and emits only on the first eligible day', async () => {
    const originalDay = contractCalendar.contractToday;
    let today = '2026-10-15';
    const clock = jest
      .spyOn(contractCalendar, 'contractToday')
      .mockImplementation((date) => (date ? originalDay(date) : today));
    try {
      const profile = await db.getRepository(FinanceRecurringProfile).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        createdAt: new Date('2026-10-15T15:00:00Z'),
        sourceModule: 'finance_invoice',
        name: 'Legacy cursor',
        status: FinanceRecurringProfileStatus.Active,
        interval: FinanceRecurringInterval.Monthly,
        amount: '100',
        currency: 'BRL',
        startDate: '2026-03-01',
        nextInvoiceDate: '2026-04-10',
        autoGenerateInvoice: true,
        metadata: { generationDay: 10, dueDay: 25 },
      });
      const count = () =>
        db.getRepository(FinanceInvoice).count({
          where: {
            sourceModule: 'finance_recurring_profile',
            sourceId: profile.id,
          },
        });
      await billing.generateDueRecurringInvoices(ctx);
      expect(await count()).toBe(0);
      expect(
        (
          await db
            .getRepository(FinanceRecurringProfile)
            .findOneByOrFail({ id: profile.id })
        ).nextInvoiceDate,
      ).toBe('2026-11-10');
      await billing.generateDueRecurringInvoices(ctx);
      expect(await count()).toBe(0);
      today = '2026-11-10';
      await billing.generateDueRecurringInvoices(ctx);
      expect(await count()).toBe(1);
      const invoice = await db.getRepository(FinanceInvoice).findOneByOrFail({
        sourceModule: 'finance_recurring_profile',
        sourceId: profile.id,
      });
      expect(invoice.issueDate).toBe('2026-11-10');
      expect(
        (
          await db
            .getRepository(FinanceRecurringProfile)
            .findOneByOrFail({ id: profile.id })
        ).nextInvoiceDate,
      ).toBe('2026-12-10');
    } finally {
      clock.mockRestore();
    }
  });

  it('also blocks manual retroactive generation and repairs a bill cursor atomically', async () => {
    const profile = await db.getRepository(FinanceRecurringProfile).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      createdAt: new Date('2026-10-15T15:00:00Z'),
      name: 'Manual legacy',
      status: FinanceRecurringProfileStatus.Active,
      interval: FinanceRecurringInterval.Monthly,
      amount: '100',
      currency: 'BRL',
      startDate: '2026-03-01',
      nextInvoiceDate: '2026-04-10',
      metadata: { generationDay: 10 },
    });
    const invoiceCount = await db.getRepository(FinanceInvoice).count();
    await expect(
      billing.generateInvoiceFromRecurringProfile(ctx, profile.id),
    ).rejects.toThrow('Agenda corrigida');
    expect(await db.getRepository(FinanceInvoice).count()).toBe(invoiceCount);
    expect(
      (
        await db
          .getRepository(FinanceRecurringProfile)
          .findOneByOrFail({ id: profile.id })
      ).nextInvoiceDate,
    ).toBe('2026-11-10');
    const recurrence = await db.getRepository(FinanceBillRecurrence).save({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      createdAt: new Date('2026-10-15T15:00:00Z'),
      name: 'Old bill',
      amount: '100',
      currency: 'BRL',
      status: FinanceBillRecurrenceStatus.Active,
      active: true,
      frequency: FinanceBillRecurrenceFrequency.Monthly,
      intervalCount: 1,
      startDate: '2026-03-01',
      nextGenerationDate: '2026-04-10',
      generationDay: 10,
      lineTemplate: [
        {
          description: 'Retainer',
          quantity: '1',
          unitPrice: '100',
          taxAmount: '0',
          categoryId: null,
          costCenterId: null,
        },
      ],
    });
    const billCount = await db.getRepository(FinanceBill).count();
    await expect(
      billing.generateBillFromRecurrence(ctx, recurrence.id),
    ).rejects.toThrow('Agenda corrigida');
    expect(
      (
        await db
          .getRepository(FinanceBillRecurrence)
          .findOneByOrFail({ id: recurrence.id })
      ).nextGenerationDate,
    ).toBe('2026-11-10');
    expect(await db.getRepository(FinanceBill).count()).toBe(billCount);
  });
});
