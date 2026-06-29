import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FinanceAccount,
  FinanceCategory,
  FinanceJournalEntry,
  FinanceJournalEntryLine,
  FinanceSetting,
} from '../entities';
import {
  FinanceAccountType,
  FinanceCategoryType,
  FinanceJournalEntryLineType,
  FinanceJournalEntryStatus,
} from '../enums';
import { FinanceDreQueryDto } from '../dto';
import { FinanceRequestContext } from './finance-context';

// ── Canonical DRE groups ──────────────────────────────────────────────────────
//
// The managerial income statement reads ONLY result accounts. Patrimonial lines
// (cash/bank, receivables, payables, equity) and transfers never reach a group —
// which is exactly why payments and account transfers are excluded "for free":
// their journal lines only touch asset/liability accounts.
type DreGroupKey =
  | 'gross_revenue'
  | 'deductions'
  | 'service_costs'
  | 'operating_expenses'
  | 'financial_result';

// Per line, after classification, a line is either mapped to a group, dropped as
// patrimonial/transfer ("excluded", silent) or flagged "unclassified" (alert).
type LineDisposition = DreGroupKey | 'excluded' | 'unclassified';

const GROUP_LABELS: Record<DreGroupKey, string> = {
  gross_revenue: 'Receita Bruta',
  deductions: 'Deduções e Impostos sobre Receita',
  service_costs: 'Custos dos Serviços Prestados',
  operating_expenses: 'Despesas Operacionais',
  financial_result: 'Resultado Financeiro',
};

const GROUP_ORDER: DreGroupKey[] = [
  'gross_revenue',
  'deductions',
  'service_costs',
  'operating_expenses',
  'financial_result',
];

// Operating-expense subgroups, in the canonical order they should be rendered.
const EXPENSE_SUBGROUPS = [
  'Comerciais',
  'Administrativas',
  'Tecnologia e Sistemas',
  'Equipe e Operação',
  'Outras Despesas Operacionais',
] as const;
type ExpenseSubgroup = (typeof EXPENSE_SUBGROUPS)[number];

interface DreLine {
  key: string;
  label: string;
  code: string | null;
  accountId: string | null;
  categoryId: string | null;
  subgroup?: ExpenseSubgroup;
  amount: number;
}

interface DreSubgroup {
  key: ExpenseSubgroup;
  label: ExpenseSubgroup;
  total: number;
  lines: DreLine[];
}

interface DreGroup {
  key: DreGroupKey;
  label: string;
  total: number;
  lines: DreLine[];
  subgroups?: DreSubgroup[];
}

interface DreSummary {
  grossRevenue: number;
  deductions: number;
  netRevenue: number;
  serviceCosts: number;
  grossProfit: number;
  operatingExpenses: number;
  operatingResult: number;
  financialResult: number;
  netResult: number;
  netMargin: number;
}

interface DreClassification {
  entriesWithoutCategory: number;
  linesWithoutCategory: number;
  linesWithoutDreGroup: number;
  amountUnclassified: number;
  complete: boolean;
}

interface DreStatement {
  summary: DreSummary;
  groups: DreGroup[];
  classification: DreClassification;
}

interface ResolvedPeriod {
  startDate: string;
  endDate: string;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Managerial income statement (DRE Gerencial).
 *
 * Canonical source: posted `finance_journal_entries` + their
 * `finance_journal_entry_lines`. Documents (invoices/bills/payments) are never
 * read directly, so a number is counted exactly once: at recognition, never
 * again at settlement.
 *
 * Accrual bucketing date priority: metadata.accrualDate → entryDate →
 * postedAt → createdAt. Reversal entries are posted (never deleted), so an
 * original credit + its reversal debit net to zero in the same bucket.
 */
@Injectable()
export class FinanceDreService {
  constructor(
    @InjectRepository(FinanceJournalEntry, 'agency')
    private readonly entriesRepo: Repository<FinanceJournalEntry>,

    @InjectRepository(FinanceJournalEntryLine, 'agency')
    private readonly linesRepo: Repository<FinanceJournalEntryLine>,

    @InjectRepository(FinanceAccount, 'agency')
    private readonly accountsRepo: Repository<FinanceAccount>,

    @InjectRepository(FinanceCategory, 'agency')
    private readonly categoriesRepo: Repository<FinanceCategory>,

    @InjectRepository(FinanceSetting, 'agency')
    private readonly settingsRepo: Repository<FinanceSetting>,
  ) {}

  async getDre(ctx: FinanceRequestContext, query: FinanceDreQueryDto) {
    const period = this.resolvePeriod(query);

    const [entries, lines, accounts, categories, settings] = await Promise.all([
      this.entriesRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          status: FinanceJournalEntryStatus.Posted,
        },
      }),
      this.linesRepo.find({
        where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      }),
      this.accountsRepo.find({
        where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      }),
      this.categoriesRepo.find({
        where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      }),
      this.settingsRepo.findOne({
        where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      }),
    ]);

    const accountsById = new Map(accounts.map((a) => [a.id, a]));
    const categoriesById = new Map(categories.map((c) => [c.id, c]));
    const linesByEntry = new Map<string, FinanceJournalEntryLine[]>();
    for (const line of lines) {
      const bucket = linesByEntry.get(line.journalEntryId);
      if (bucket) bucket.push(line);
      else linesByEntry.set(line.journalEntryId, [line]);
    }

    const current = this.computeStatement(
      entries,
      linesByEntry,
      accountsById,
      categoriesById,
      period,
    );

    const response: Record<string, unknown> = {
      period,
      currency: settings?.baseCurrency ?? 'BRL',
      ...current.summary,
      groups: current.groups,
      classification: current.classification,
    };

    if (query.compare) {
      const previousPeriod = this.previousPeriod(period);
      const previous = this.computeStatement(
        entries,
        linesByEntry,
        accountsById,
        categoriesById,
        previousPeriod,
      );
      response.comparison = {
        period: previousPeriod,
        ...previous.summary,
        groups: previous.groups.map((g) => ({ key: g.key, total: g.total })),
      };
    }

    return response;
  }

  // ── Statement assembly ──────────────────────────────────────────────────────

  private computeStatement(
    entries: FinanceJournalEntry[],
    linesByEntry: Map<string, FinanceJournalEntryLine[]>,
    accountsById: Map<string, FinanceAccount>,
    categoriesById: Map<string, FinanceCategory>,
    period: ResolvedPeriod,
  ): DreStatement {
    // Accumulators: group → (detail key → DreLine).
    const groups = new Map<DreGroupKey, Map<string, DreLine>>();
    for (const key of GROUP_ORDER) groups.set(key, new Map());

    const classification: DreClassification = {
      entriesWithoutCategory: 0,
      linesWithoutCategory: 0,
      linesWithoutDreGroup: 0,
      amountUnclassified: 0,
      complete: true,
    };

    for (const entry of entries) {
      const bucket = this.bucketDate(entry);
      if (bucket < period.startDate || bucket > period.endDate) continue;

      const entryLines = linesByEntry.get(entry.id) ?? [];
      let entryHasResultLineWithoutCategory = false;

      for (const line of entryLines) {
        const account = line.accountId ? accountsById.get(line.accountId) ?? null : null;
        const category = line.categoryId
          ? categoriesById.get(line.categoryId) ?? null
          : null;

        const disposition = this.classify(account, category);
        if (disposition === 'excluded') continue;

        const debit = line.lineType === FinanceJournalEntryLineType.Debit;
        const amount = toNumber(line.amount);

        if (disposition === 'unclassified') {
          classification.linesWithoutDreGroup += 1;
          classification.amountUnclassified += amount;
          continue;
        }

        // From here the line belongs to a real DRE group.
        if (!category) {
          classification.linesWithoutCategory += 1;
          entryHasResultLineWithoutCategory = true;
        }

        // Sign rule: revenue/financial increase on CREDIT; cost/deduction/
        // expense increase on DEBIT. A reversal swaps debit↔credit, so its
        // contribution naturally subtracts from the original.
        const signed =
          disposition === 'gross_revenue' || disposition === 'financial_result'
            ? (debit ? -amount : amount)
            : (debit ? amount : -amount);

        const detailKey = category
          ? `cat:${category.id}`
          : account
            ? `acc:${account.id}`
            : 'unclassified';
        const label = category?.name ?? account?.name ?? 'Não classificado';

        const groupMap = groups.get(disposition)!;
        const existing = groupMap.get(detailKey);
        if (existing) {
          existing.amount = roundMoney(existing.amount + signed);
        } else {
          const dreLine: DreLine = {
            key: detailKey,
            label,
            code: account?.code ?? null,
            accountId: account?.id ?? null,
            categoryId: category?.id ?? null,
            amount: roundMoney(signed),
          };
          if (disposition === 'operating_expenses') {
            dreLine.subgroup = this.expenseSubgroup(account, category);
          }
          groupMap.set(detailKey, dreLine);
        }
      }

      if (entryHasResultLineWithoutCategory) {
        classification.entriesWithoutCategory += 1;
      }
    }

    const groupList: DreGroup[] = GROUP_ORDER.map((key) => {
      const lines = [...groups.get(key)!.values()].sort((a, b) => b.amount - a.amount);
      const total = roundMoney(lines.reduce((sum, l) => sum + l.amount, 0));
      const group: DreGroup = { key, label: GROUP_LABELS[key], total, lines };
      if (key === 'operating_expenses') {
        group.subgroups = this.buildExpenseSubgroups(lines);
      }
      return group;
    });

    const byKey = (key: DreGroupKey) =>
      groupList.find((g) => g.key === key)?.total ?? 0;

    const grossRevenue = byKey('gross_revenue');
    const deductions = byKey('deductions');
    const netRevenue = roundMoney(grossRevenue - deductions);
    const serviceCosts = byKey('service_costs');
    const grossProfit = roundMoney(netRevenue - serviceCosts);
    const operatingExpenses = byKey('operating_expenses');
    const operatingResult = roundMoney(grossProfit - operatingExpenses);
    const financialResult = byKey('financial_result');
    const netResult = roundMoney(operatingResult + financialResult);
    const netMargin = netRevenue !== 0 ? roundMoney(netResult / netRevenue) : 0;

    classification.amountUnclassified = roundMoney(classification.amountUnclassified);
    classification.complete = classification.linesWithoutDreGroup === 0;

    return {
      summary: {
        grossRevenue,
        deductions,
        netRevenue,
        serviceCosts,
        grossProfit,
        operatingExpenses,
        operatingResult,
        financialResult,
        netResult,
        netMargin,
      },
      groups: groupList,
      classification,
    };
  }

  private buildExpenseSubgroups(lines: DreLine[]): DreSubgroup[] {
    const map = new Map<ExpenseSubgroup, DreLine[]>();
    for (const line of lines) {
      const sub = line.subgroup ?? 'Outras Despesas Operacionais';
      const bucket = map.get(sub);
      if (bucket) bucket.push(line);
      else map.set(sub, [line]);
    }
    return EXPENSE_SUBGROUPS.filter((sub) => map.has(sub)).map((sub) => {
      const subLines = map.get(sub)!;
      return {
        key: sub,
        label: sub,
        total: roundMoney(subLines.reduce((sum, l) => sum + l.amount, 0)),
        lines: subLines,
      };
    });
  }

  // ── Classification ──────────────────────────────────────────────────────────

  /**
   * Map a journal line to a DRE disposition. Priority, per spec:
   *   1. an explicit `metadata.dreGroup = 'financial_result'` override;
   *   2. category.type (when the line carries a category);
   *   3. account.type;
   *   4. fallback → 'unclassified'.
   * Patrimonial accounts (asset/liability/equity) and transfer categories are
   * 'excluded' (silently dropped, no alert).
   */
  private classify(
    account: FinanceAccount | null,
    category: FinanceCategory | null,
  ): LineDisposition {
    const hint =
      (category?.metadata?.dreGroup as string | undefined) ??
      (account?.metadata?.dreGroup as string | undefined);
    if (hint === 'financial_result') return 'financial_result';

    if (category) {
      switch (category.type) {
        case FinanceCategoryType.Revenue:
          return 'gross_revenue';
        case FinanceCategoryType.Cost:
          return 'service_costs';
        case FinanceCategoryType.Expense:
          return 'operating_expenses';
        case FinanceCategoryType.Tax:
          return 'deductions';
        case FinanceCategoryType.Transfer:
          return 'excluded';
      }
    }

    if (account) {
      switch (account.type) {
        case FinanceAccountType.Revenue:
          return 'gross_revenue';
        case FinanceAccountType.CostOfGoodsSold:
          return 'service_costs';
        case FinanceAccountType.Expense:
          return 'operating_expenses';
        case FinanceAccountType.Asset:
        case FinanceAccountType.Liability:
        case FinanceAccountType.Equity:
          return 'excluded';
      }
    }

    return 'unclassified';
  }

  private expenseSubgroup(
    account: FinanceAccount | null,
    category: FinanceCategory | null,
  ): ExpenseSubgroup {
    const hint =
      (category?.metadata?.dreSubgroup as string | undefined) ??
      (account?.metadata?.dreSubgroup as string | undefined);
    if (hint && (EXPENSE_SUBGROUPS as readonly string[]).includes(hint)) {
      return hint as ExpenseSubgroup;
    }

    const code = account?.code ?? '';
    if (code === '5.1.03') return 'Comerciais';
    if (code === '5.1.04') return 'Administrativas';
    if (code === '5.1.02') return 'Tecnologia e Sistemas';

    const name = `${category?.name ?? ''} ${account?.name ?? ''}`.toLowerCase();
    if (/m[ií]dia|tr[áa]fego|marketing|comercial|vendas|publicidade|an[úu]ncio/.test(name)) {
      return 'Comerciais';
    }
    if (/ferramenta|software|sistema|tecnologia|saas|assinatura|hosting|servidor/.test(name)) {
      return 'Tecnologia e Sistemas';
    }
    if (/administr|contábil|contabil|jur[íi]dico|escrit[óo]rio|aluguel/.test(name)) {
      return 'Administrativas';
    }
    if (/equipe|folha|sal[áa]rio|pr[óo].?labore|freelan|terceir|colaborador/.test(name)) {
      return 'Equipe e Operação';
    }
    return 'Outras Despesas Operacionais';
  }

  // ── Period helpers ──────────────────────────────────────────────────────────

  /** Accrual bucket date for an entry. */
  private bucketDate(entry: FinanceJournalEntry): string {
    const accrual = entry.metadata?.accrualDate;
    if (typeof accrual === 'string' && accrual) return accrual.slice(0, 10);
    if (entry.entryDate) return String(entry.entryDate).slice(0, 10);
    if (entry.postedAt) return isoDate(new Date(entry.postedAt));
    return isoDate(new Date(entry.createdAt));
  }

  private resolvePeriod(query: FinanceDreQueryDto): ResolvedPeriod {
    if (query.startDate && query.endDate) {
      return this.orderPeriod(query.startDate.slice(0, 10), query.endDate.slice(0, 10));
    }

    if (query.year && query.month) {
      const start = `${query.year}-${pad2(query.month)}-01`;
      const end = isoDate(new Date(Date.UTC(query.year, query.month, 0)));
      return { startDate: start, endDate: end };
    }

    if (query.year) {
      return { startDate: `${query.year}-01-01`, endDate: `${query.year}-12-31` };
    }

    // Fallback: current month.
    const now = new Date();
    const start = isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
    const end = isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
    return { startDate: start, endDate: end };
  }

  private orderPeriod(a: string, b: string): ResolvedPeriod {
    return a <= b ? { startDate: a, endDate: b } : { startDate: b, endDate: a };
  }

  /** Immediately preceding window of the same length. */
  private previousPeriod(period: ResolvedPeriod): ResolvedPeriod {
    const start = new Date(`${period.startDate}T00:00:00.000Z`);
    const end = new Date(`${period.endDate}T00:00:00.000Z`);
    const dayMs = 86_400_000;
    const lengthDays = Math.round((end.getTime() - start.getTime()) / dayMs) + 1;
    const prevEnd = new Date(start.getTime() - dayMs);
    const prevStart = new Date(prevEnd.getTime() - (lengthDays - 1) * dayMs);
    return { startDate: isoDate(prevStart), endDate: isoDate(prevEnd) };
  }
}
