import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  FinanceAccount,
  FinanceBankAccount,
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
  FinanceDocumentType,
  FinanceJournalEntryLineType,
  FinanceJournalEntryStatus,
  FinanceJournalType,
  FinancePaymentDirection,
  FinancePaymentStatus,
} from '../enums';
import { FinanceRequestContext } from './finance-context';
import { FinanceDocumentNumberingService } from './finance-document-numbering.service';

/**
 * Well-known chart-of-accounts codes seeded by FinanceDefaultsService. These
 * are the anchor accounts the automatic posting needs. They are resolved by
 * code (with no silent guessing) so a missing one surfaces a clear,
 * actionable error rather than an unbalanced ledger.
 */
const SYSTEM_ACCOUNT_CODE = {
  cashBank: '1.1.01', // Caixa e Bancos
  receivable: '1.1.02', // Contas a Receber (Clientes a receber)
  payable: '2.1.01', // Contas a Pagar (Fornecedores a pagar)
  defaultRevenue: '3.1.01', // Receita de Serviços
  defaultExpense: '5.1.01', // Despesas Operacionais
} as const;

type EventType =
  | 'invoice_confirmed'
  | 'invoice_reversed'
  | 'bill_confirmed'
  | 'bill_reversed'
  | 'customer_payment_completed'
  | 'supplier_payment_completed'
  | 'payment_reversed';

const REVERSAL_EVENTS: EventType[] = [
  'invoice_reversed',
  'bill_reversed',
  'payment_reversed',
];

interface PostingLine {
  lineType: FinanceJournalEntryLineType;
  accountId: string | null;
  categoryId?: string | null;
  costCenterId?: string | null;
  contactId?: string | null;
  description?: string | null;
  amount: number;
}

interface CreatePostedEntryParams {
  entryDate: string;
  description: string | null;
  journalId: string | null;
  sourceType: string;
  sourceId: string;
  sourceLineId?: string | null;
  eventType: EventType;
  reversesEntryId?: string | null;
  metadata?: Record<string, unknown>;
  lines: PostingLine[];
}

function toMoney(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function cents(value: number): number {
  return Math.round(value * 100);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Central double-entry posting engine for the Finance module.
 *
 * It owns every debit/credit rule so controllers and the billing service stay
 * free of accounting logic. Responsibilities:
 *  - resolve chart-of-accounts accounts (system anchors + per-line revenue/cost);
 *  - resolve the journal for the document type;
 *  - build balanced header + lines and persist them as POSTED entries;
 *  - guarantee idempotency through a persistent key;
 *  - produce linked reversal entries (never delete a posted entry);
 *  - keep the source document linked to its entry.
 */
@Injectable()
export class FinancePostingService {
  constructor(
    @InjectDataSource('agency')
    private readonly dataSource: DataSource,
    private readonly documentNumberingService: FinanceDocumentNumberingService,
  ) {}

  // ── Public event API ────────────────────────────────────────────────────

  /** Confirmed invoice → DEBIT receivable / CREDIT revenue per item-account. */
  async postInvoiceConfirmed(
    ctx: FinanceRequestContext,
    invoiceId: string,
    manager?: EntityManager,
  ): Promise<FinanceJournalEntry | null> {
    return this.withManager(manager, async (m) => {
      const invoice = await m.getRepository(FinanceInvoice).findOne({
        where: { id: invoiceId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      });
      if (!invoice) return null;

      const lines = await m.getRepository(FinanceInvoiceLine).find({
        where: { invoiceId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
        order: { createdAt: 'ASC' },
      });
      if (!lines.length) return null;

      const receivableId = await this.resolveSystemAccountId(
        m,
        ctx,
        SYSTEM_ACCOUNT_CODE.receivable,
        'Contas a Receber',
      );

      // Group credits by (account, category, cost center) so distinct revenue
      // accounts / dimensions stay separate while identical ones are merged.
      const groups = new Map<
        string,
        { accountId: string; categoryId: string | null; costCenterId: string | null; amount: number }
      >();
      let total = 0;
      for (const line of lines) {
        const amount = toMoney(line.totalAmount);
        if (amount <= 0) continue;
        const accountId = await this.resolveLineRevenueAccountId(m, ctx, line.categoryId);
        const key = `${accountId}|${line.categoryId ?? '-'}|${line.costCenterId ?? '-'}`;
        const group = groups.get(key) ?? {
          accountId,
          categoryId: line.categoryId ?? null,
          costCenterId: line.costCenterId ?? null,
          amount: 0,
        };
        group.amount += amount;
        groups.set(key, group);
        total += amount;
      }
      if (total <= 0) return null;

      const journalId = await this.resolveJournalId(m, ctx, FinanceJournalType.Sales);
      const postingLines: PostingLine[] = [
        {
          lineType: FinanceJournalEntryLineType.Debit,
          accountId: receivableId,
          contactId: invoice.customerId,
          description: `Recebível ${invoice.invoiceNumber}`,
          amount: total,
        },
        ...[...groups.values()].map<PostingLine>((group) => ({
          lineType: FinanceJournalEntryLineType.Credit,
          accountId: group.accountId,
          categoryId: group.categoryId,
          costCenterId: group.costCenterId,
          contactId: invoice.customerId,
          description: `Receita ${invoice.invoiceNumber}`,
          amount: group.amount,
        })),
      ];

      return this.createPostedEntry(m, ctx, {
        entryDate: invoice.issueDate ?? todayIso(),
        description: `Fatura ${invoice.invoiceNumber}`,
        journalId,
        sourceType: 'invoice',
        sourceId: invoice.id,
        eventType: 'invoice_confirmed',
        metadata: {
          sourceNumber: invoice.invoiceNumber,
          accrualDate: invoice.periodStart ?? invoice.issueDate ?? null,
        },
        lines: postingLines,
      });
    });
  }

  /** Reverse the confirmed invoice entry (cancellation). */
  async reverseInvoice(
    ctx: FinanceRequestContext,
    invoiceId: string,
    manager?: EntityManager,
  ): Promise<FinanceJournalEntry[]> {
    return this.withManager(manager, (m) =>
      this.reverseEntriesForSource(m, ctx, 'invoice', invoiceId, 'invoice_reversed'),
    );
  }

  /** Confirmed bill → DEBIT cost/expense per item-account / CREDIT payable. */
  async postBillConfirmed(
    ctx: FinanceRequestContext,
    billId: string,
    manager?: EntityManager,
  ): Promise<FinanceJournalEntry | null> {
    return this.withManager(manager, async (m) => {
      const bill = await m.getRepository(FinanceBill).findOne({
        where: { id: billId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      });
      if (!bill) return null;

      const lines = await m.getRepository(FinanceBillLine).find({
        where: { billId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
        order: { createdAt: 'ASC' },
      });
      if (!lines.length) return null;

      const payableId = await this.resolveSystemAccountId(
        m,
        ctx,
        SYSTEM_ACCOUNT_CODE.payable,
        'Contas a Pagar',
      );

      const groups = new Map<
        string,
        { accountId: string; categoryId: string | null; costCenterId: string | null; amount: number }
      >();
      let total = 0;
      for (const line of lines) {
        const amount = toMoney(line.totalAmount);
        if (amount <= 0) continue;
        const categoryId = line.categoryId ?? bill.categoryId ?? null;
        const costCenterId = line.costCenterId ?? bill.costCenterId ?? null;
        const accountId = await this.resolveLineExpenseAccountId(m, ctx, categoryId);
        const key = `${accountId}|${categoryId ?? '-'}|${costCenterId ?? '-'}`;
        const group = groups.get(key) ?? { accountId, categoryId, costCenterId, amount: 0 };
        group.amount += amount;
        groups.set(key, group);
        total += amount;
      }
      if (total <= 0) return null;

      const journalId = await this.resolveJournalId(m, ctx, FinanceJournalType.Purchase);
      const postingLines: PostingLine[] = [
        ...[...groups.values()].map<PostingLine>((group) => ({
          lineType: FinanceJournalEntryLineType.Debit,
          accountId: group.accountId,
          categoryId: group.categoryId,
          costCenterId: group.costCenterId,
          contactId: bill.vendorId,
          description: `Custo ${bill.billNumber}`,
          amount: group.amount,
        })),
        {
          lineType: FinanceJournalEntryLineType.Credit,
          accountId: payableId,
          contactId: bill.vendorId,
          description: `A pagar ${bill.billNumber}`,
          amount: total,
        },
      ];

      return this.createPostedEntry(m, ctx, {
        entryDate: bill.issueDate ?? todayIso(),
        description: `Conta a pagar ${bill.billNumber}`,
        journalId,
        sourceType: 'bill',
        sourceId: bill.id,
        eventType: 'bill_confirmed',
        metadata: {
          sourceNumber: bill.billNumber,
          accrualDate: bill.periodStart ?? bill.issueDate ?? null,
        },
        lines: postingLines,
      });
    });
  }

  /** Reverse the confirmed bill entry (cancellation). */
  async reverseBill(
    ctx: FinanceRequestContext,
    billId: string,
    manager?: EntityManager,
  ): Promise<FinanceJournalEntry[]> {
    return this.withManager(manager, (m) =>
      this.reverseEntriesForSource(m, ctx, 'bill', billId, 'bill_reversed'),
    );
  }

  /**
   * Settlement (baixa) for a completed payment allocation. One entry per
   * allocation, which makes partial settlements idempotent and additive.
   *  - customer: DEBIT bank/cash chart account / CREDIT receivable;
   *  - supplier: DEBIT payable / CREDIT bank/cash chart account.
   * Revenue/cost accounts are intentionally NOT touched here — they were
   * recognised at invoice/bill confirmation.
   */
  async postPaymentAllocationSettlement(
    ctx: FinanceRequestContext,
    payment: FinancePayment,
    allocation: FinancePaymentAllocation,
    manager?: EntityManager,
  ): Promise<FinanceJournalEntry | null> {
    if (payment.status !== FinancePaymentStatus.Completed) return null;
    const amount = toMoney(allocation.amount);
    if (amount <= 0) return null;

    return this.withManager(manager, async (m) => {
      const bankAccountId = await this.resolveBankChartAccountId(m, ctx, payment.bankAccountId);
      const journalId = await this.resolveJournalId(m, ctx, FinanceJournalType.Bank);
      const isCustomer = payment.direction === FinancePaymentDirection.Customer;

      let lines: PostingLine[];
      let eventType: EventType;
      if (isCustomer) {
        const receivableId = await this.resolveSystemAccountId(
          m,
          ctx,
          SYSTEM_ACCOUNT_CODE.receivable,
          'Contas a Receber',
        );
        lines = [
          {
            lineType: FinanceJournalEntryLineType.Debit,
            accountId: bankAccountId,
            contactId: payment.contactId,
            description: payment.description ?? 'Recebimento',
            amount,
          },
          {
            lineType: FinanceJournalEntryLineType.Credit,
            accountId: receivableId,
            contactId: payment.contactId,
            description: 'Baixa de recebível',
            amount,
          },
        ];
        eventType = 'customer_payment_completed';
      } else {
        const payableId = await this.resolveSystemAccountId(
          m,
          ctx,
          SYSTEM_ACCOUNT_CODE.payable,
          'Contas a Pagar',
        );
        lines = [
          {
            lineType: FinanceJournalEntryLineType.Debit,
            accountId: payableId,
            contactId: payment.contactId,
            description: 'Baixa de conta a pagar',
            amount,
          },
          {
            lineType: FinanceJournalEntryLineType.Credit,
            accountId: bankAccountId,
            contactId: payment.contactId,
            description: payment.description ?? 'Pagamento',
            amount,
          },
        ];
        eventType = 'supplier_payment_completed';
      }

      return this.createPostedEntry(m, ctx, {
        entryDate: payment.paymentDate,
        description: payment.description ?? `Baixa pagamento ${payment.id.slice(0, 8)}`,
        journalId,
        sourceType: 'payment',
        sourceId: payment.id,
        sourceLineId: allocation.id,
        eventType,
        metadata: {
          allocationId: allocation.id,
          targetType: allocation.targetType,
          targetId: allocation.targetId,
        },
        lines,
      });
    });
  }

  /** Reverse every settlement entry produced by a payment (cancel/refund). */
  async reversePayment(
    ctx: FinanceRequestContext,
    payment: FinancePayment,
    manager?: EntityManager,
  ): Promise<FinanceJournalEntry[]> {
    return this.withManager(manager, (m) =>
      this.reverseEntriesForSource(m, ctx, 'payment', payment.id, 'payment_reversed'),
    );
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private withManager<T>(
    manager: EntityManager | undefined,
    fn: (m: EntityManager) => Promise<T>,
  ): Promise<T> {
    if (manager) return fn(manager);
    return this.dataSource.transaction(fn);
  }

  private buildIdempotencyKey(
    ctx: FinanceRequestContext,
    sourceType: string,
    sourceId: string,
    sourceLineId: string | null | undefined,
    eventType: EventType,
  ): string {
    return [
      ctx.tenantId,
      ctx.workspaceId,
      sourceType,
      sourceId,
      sourceLineId ?? '-',
      eventType,
    ].join(':');
  }

  private async createPostedEntry(
    m: EntityManager,
    ctx: FinanceRequestContext,
    params: CreatePostedEntryParams,
  ): Promise<FinanceJournalEntry> {
    const idempotencyKey = this.buildIdempotencyKey(
      ctx,
      params.sourceType,
      params.sourceId,
      params.sourceLineId,
      params.eventType,
    );

    const existing = await m.getRepository(FinanceJournalEntry).findOne({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, idempotencyKey },
    });
    if (existing) {
      // Already posted for this event → idempotent no-op.
      return existing;
    }

    let debitCents = 0;
    let creditCents = 0;
    for (const line of params.lines) {
      if (line.lineType === FinanceJournalEntryLineType.Debit) {
        debitCents += cents(line.amount);
      } else {
        creditCents += cents(line.amount);
      }
    }

    if (debitCents <= 0 && creditCents <= 0) {
      throw new BadRequestException('Lançamento automático com valor zero');
    }
    if (debitCents !== creditCents) {
      throw new BadRequestException(
        `Lançamento automático desbalanceado (débito ${money(debitCents / 100)} ≠ crédito ${money(creditCents / 100)})`,
      );
    }

    const entryNumber = await this.documentNumberingService.generate(
      ctx,
      FinanceDocumentType.JournalEntry,
      new Date(`${params.entryDate}T00:00:00.000Z`),
    );

    const entriesRepo = m.getRepository(FinanceJournalEntry);
    const linesRepo = m.getRepository(FinanceJournalEntryLine);
    const now = new Date();

    const entry = await entriesRepo.save(
      entriesRepo.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        entryNumber,
        status: FinanceJournalEntryStatus.Posted,
        entryDate: params.entryDate,
        description: params.description,
        journalId: params.journalId,
        sourceModule: params.sourceType,
        sourceId: params.sourceId,
        sourceLineId: params.sourceLineId ?? null,
        eventType: params.eventType,
        idempotencyKey,
        reversesEntryId: params.reversesEntryId ?? null,
        totalDebit: money(debitCents / 100),
        totalCredit: money(creditCents / 100),
        postedAt: now,
        postedById: ctx.userId,
        metadata: params.metadata ?? {},
      }),
    );

    await linesRepo.save(
      params.lines.map((line) =>
        linesRepo.create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          journalEntryId: entry.id,
          lineType: line.lineType,
          accountId: line.accountId ?? null,
          categoryId: line.categoryId ?? null,
          costCenterId: line.costCenterId ?? null,
          contactId: line.contactId ?? null,
          description: line.description ?? null,
          amount: money(line.amount),
          metadata: {},
        }),
      ),
    );

    return entry;
  }

  private async reverseEntriesForSource(
    m: EntityManager,
    ctx: FinanceRequestContext,
    sourceType: string,
    sourceId: string,
    reversalEvent: EventType,
  ): Promise<FinanceJournalEntry[]> {
    const originals = await m.getRepository(FinanceJournalEntry).find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        sourceModule: sourceType,
        sourceId,
        status: FinanceJournalEntryStatus.Posted,
      },
      order: { createdAt: 'ASC' },
    });

    const reversals: FinanceJournalEntry[] = [];
    for (const original of originals) {
      // Never reverse a reversal.
      if (original.reversesEntryId) continue;
      if (original.eventType && REVERSAL_EVENTS.includes(original.eventType as EventType)) {
        continue;
      }
      // Skip entries that were already reversed (idempotent re-cancellation).
      const alreadyReversed = await m.getRepository(FinanceJournalEntry).findOne({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          reversesEntryId: original.id,
        },
      });
      if (alreadyReversed) continue;

      const reversal = await this.createReversalEntry(m, ctx, original, reversalEvent);
      if (reversal) reversals.push(reversal);
    }
    return reversals;
  }

  private async createReversalEntry(
    m: EntityManager,
    ctx: FinanceRequestContext,
    original: FinanceJournalEntry,
    reversalEvent: EventType,
  ): Promise<FinanceJournalEntry | null> {
    const originalLines = await m.getRepository(FinanceJournalEntryLine).find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        journalEntryId: original.id,
      },
      order: { createdAt: 'ASC' },
    });
    if (!originalLines.length) return null;

    const reversedLines: PostingLine[] = originalLines.map((line) => ({
      lineType:
        line.lineType === FinanceJournalEntryLineType.Debit
          ? FinanceJournalEntryLineType.Credit
          : FinanceJournalEntryLineType.Debit,
      accountId: line.accountId,
      categoryId: line.categoryId,
      costCenterId: line.costCenterId,
      contactId: line.contactId,
      description: line.description,
      amount: toMoney(line.amount),
    }));

    const reversal = await this.createPostedEntry(m, ctx, {
      entryDate: todayIso(),
      description: `Estorno de ${original.entryNumber}`,
      journalId: original.journalId,
      sourceType: original.sourceModule ?? 'unknown',
      sourceId: original.sourceId ?? original.id,
      sourceLineId: original.id,
      eventType: reversalEvent,
      reversesEntryId: original.id,
      metadata: {
        ...(original.metadata ?? {}),
        reversesEntryNumber: original.entryNumber,
      },
      lines: reversedLines,
    });

    // Back-link the original to its reversal (best-effort metadata link).
    if (reversal.id !== original.id && reversal.reversesEntryId === original.id) {
      original.metadata = {
        ...(original.metadata ?? {}),
        reversedByEntryId: reversal.id,
        reversedByEntryNumber: reversal.entryNumber,
      };
      await m.getRepository(FinanceJournalEntry).save(original);
    }

    return reversal;
  }

  // ── Account / journal resolution ────────────────────────────────────────

  private async findAccountByCode(
    m: EntityManager,
    ctx: FinanceRequestContext,
    code: string,
  ): Promise<FinanceAccount | null> {
    return m.getRepository(FinanceAccount).findOne({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, code },
    });
  }

  private async resolveSystemAccountId(
    m: EntityManager,
    ctx: FinanceRequestContext,
    code: string,
    label: string,
  ): Promise<string> {
    const account = await this.findAccountByCode(m, ctx, code);
    if (!account) {
      throw new BadRequestException(
        `Conta de sistema "${label}" (${code}) não encontrada. ` +
          'Execute a configuração padrão do Finance (setup/defaults).',
      );
    }
    return account.id;
  }

  private async resolveLineRevenueAccountId(
    m: EntityManager,
    ctx: FinanceRequestContext,
    categoryId: string | null,
  ): Promise<string> {
    const fromCategory = await this.resolveCategoryAccountId(m, ctx, categoryId);
    if (fromCategory) return fromCategory;
    return this.resolveSystemAccountId(
      m,
      ctx,
      SYSTEM_ACCOUNT_CODE.defaultRevenue,
      'Receita de Serviços',
    );
  }

  private async resolveLineExpenseAccountId(
    m: EntityManager,
    ctx: FinanceRequestContext,
    categoryId: string | null,
  ): Promise<string> {
    const fromCategory = await this.resolveCategoryAccountId(m, ctx, categoryId);
    if (fromCategory) return fromCategory;
    return this.resolveSystemAccountId(
      m,
      ctx,
      SYSTEM_ACCOUNT_CODE.defaultExpense,
      'Despesas Operacionais',
    );
  }

  private async resolveCategoryAccountId(
    m: EntityManager,
    ctx: FinanceRequestContext,
    categoryId: string | null,
  ): Promise<string | null> {
    if (!categoryId) return null;
    const category = await m.getRepository(FinanceCategory).findOne({
      where: { id: categoryId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });
    return category?.accountId ?? null;
  }

  private async resolveBankChartAccountId(
    m: EntityManager,
    ctx: FinanceRequestContext,
    bankAccountId: string | null,
  ): Promise<string> {
    if (bankAccountId) {
      const bankAccount = await m.getRepository(FinanceBankAccount).findOne({
        where: { id: bankAccountId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      });
      if (bankAccount?.accountId) return bankAccount.accountId;
    }
    // Fall back to the system cash/bank account so settlements never break on a
    // bank account that has not been linked to the chart of accounts yet.
    return this.resolveSystemAccountId(
      m,
      ctx,
      SYSTEM_ACCOUNT_CODE.cashBank,
      'Caixa e Bancos',
    );
  }

  private async resolveJournalId(
    m: EntityManager,
    ctx: FinanceRequestContext,
    type: FinanceJournalType,
  ): Promise<string | null> {
    const journal = await m.getRepository(FinanceJournal).findOne({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, type, active: true },
    });
    return journal?.id ?? null;
  }
}
