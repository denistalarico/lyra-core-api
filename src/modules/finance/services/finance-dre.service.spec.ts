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
import { FinanceDreService } from './finance-dre.service';

const TENANT = 'tenant-1';
const WORKSPACE = 'workspace-1';

/** Minimal in-memory repository supporting equality-only `where`. */
class InMemoryRepo<T extends Record<string, any>> {
  rows: T[] = [];

  private match(row: T, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => row[key] === value);
  }

  find(options: { where?: Record<string, unknown> } = {}): Promise<T[]> {
    const where = options.where ?? {};
    return Promise.resolve(this.rows.filter((row) => this.match(row, where)));
  }

  findOne(options: { where?: Record<string, unknown> } = {}): Promise<T | null> {
    const where = options.where ?? {};
    return Promise.resolve(this.rows.find((row) => this.match(row, where)) ?? null);
  }
}

type LineSeed = {
  type: FinanceJournalEntryLineType;
  amount: string;
  accountId?: string | null;
  categoryId?: string | null;
};

function setup() {
  const entriesRepo = new InMemoryRepo<any>();
  const linesRepo = new InMemoryRepo<any>();
  const accountsRepo = new InMemoryRepo<any>();
  const categoriesRepo = new InMemoryRepo<any>();
  const settingsRepo = new InMemoryRepo<any>();

  settingsRepo.rows.push({
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    baseCurrency: 'BRL',
  });

  let seq = 0;
  const nextId = (p: string) => `${p}-${(seq += 1)}`;

  function addAccount(
    code: string,
    type: FinanceAccountType,
    extra: Partial<FinanceAccount> = {},
  ) {
    const id = `acc-${code}`;
    accountsRepo.rows.push({
      id,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      code,
      name: `Conta ${code}`,
      type,
      metadata: {},
      ...extra,
    });
    return id;
  }

  function addCategory(
    name: string,
    type: FinanceCategoryType,
    extra: Partial<FinanceCategory> = {},
  ) {
    const id = nextId('cat');
    categoriesRepo.rows.push({
      id,
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      name,
      type,
      metadata: {},
      ...extra,
    });
    return id;
  }

  function addEntry(params: {
    lines: LineSeed[];
    entryDate?: string;
    accrualDate?: string | null;
    status?: FinanceJournalEntryStatus;
    tenantId?: string;
    workspaceId?: string;
  }) {
    const tenantId = params.tenantId ?? TENANT;
    const workspaceId = params.workspaceId ?? WORKSPACE;
    const entryId = nextId('entry');
    entriesRepo.rows.push({
      id: entryId,
      tenantId,
      workspaceId,
      status: params.status ?? FinanceJournalEntryStatus.Posted,
      entryDate: params.entryDate ?? '2026-06-15',
      metadata:
        params.accrualDate !== undefined && params.accrualDate !== null
          ? { accrualDate: params.accrualDate }
          : {},
      createdAt: new Date('2026-06-15T00:00:00Z'),
      postedAt: new Date('2026-06-15T00:00:00Z'),
    });
    for (const line of params.lines) {
      linesRepo.rows.push({
        id: nextId('line'),
        tenantId,
        workspaceId,
        journalEntryId: entryId,
        lineType: line.type,
        accountId: line.accountId ?? null,
        categoryId: line.categoryId ?? null,
        amount: line.amount,
        createdAt: new Date(),
      });
    }
    return entryId;
  }

  const service = new FinanceDreService(
    entriesRepo as unknown as Repository<FinanceJournalEntry>,
    linesRepo as unknown as Repository<FinanceJournalEntryLine>,
    accountsRepo as unknown as Repository<FinanceAccount>,
    categoriesRepo as unknown as Repository<FinanceCategory>,
    settingsRepo as unknown as Repository<FinanceSetting>,
  );

  return { service, addAccount, addCategory, addEntry };
}

const ctx = { tenantId: TENANT, workspaceId: WORKSPACE, userId: 'user-1' };
const JUNE = { startDate: '2026-06-01', endDate: '2026-06-30' };

const { Debit, Credit } = FinanceJournalEntryLineType;

describe('FinanceDreService', () => {
  it('1. revenue credited to a revenue account counts as positive gross revenue', async () => {
    const env = setup();
    const recv = env.addAccount('1.1.02', FinanceAccountType.Asset);
    const rev = env.addAccount('3.1.01', FinanceAccountType.Revenue);
    const catRev = env.addCategory('Mensalidade', FinanceCategoryType.Revenue);
    env.addEntry({
      lines: [
        { type: Debit, amount: '1000.00', accountId: recv },
        { type: Credit, amount: '1000.00', accountId: rev, categoryId: catRev },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.grossRevenue).toBe(1000);
    expect(dre.netRevenue).toBe(1000);
    expect(dre.netResult).toBe(1000);
  });

  it('2. a revenue reversal reduces gross revenue (net zero)', async () => {
    const env = setup();
    const recv = env.addAccount('1.1.02', FinanceAccountType.Asset);
    const rev = env.addAccount('3.1.01', FinanceAccountType.Revenue);
    const catRev = env.addCategory('Mensalidade', FinanceCategoryType.Revenue);
    env.addEntry({
      lines: [
        { type: Debit, amount: '1000.00', accountId: recv },
        { type: Credit, amount: '1000.00', accountId: rev, categoryId: catRev },
      ],
    });
    // Reversal swaps debit/credit.
    env.addEntry({
      lines: [
        { type: Credit, amount: '1000.00', accountId: recv },
        { type: Debit, amount: '1000.00', accountId: rev, categoryId: catRev },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.grossRevenue).toBe(0);
    expect(dre.netResult).toBe(0);
  });

  it('3. an expense debited to an expense account counts as a positive operating expense', async () => {
    const env = setup();
    const pay = env.addAccount('2.1.01', FinanceAccountType.Liability);
    const exp = env.addAccount('5.1.01', FinanceAccountType.Expense);
    const catExp = env.addCategory('Administrativo', FinanceCategoryType.Expense);
    env.addEntry({
      lines: [
        { type: Debit, amount: '500.00', accountId: exp, categoryId: catExp },
        { type: Credit, amount: '500.00', accountId: pay },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.operatingExpenses).toBe(500);
    expect(dre.operatingResult).toBe(-500);
    expect(dre.netResult).toBe(-500);
  });

  it('4. an expense reversal reduces operating expenses', async () => {
    const env = setup();
    const pay = env.addAccount('2.1.01', FinanceAccountType.Liability);
    const exp = env.addAccount('5.1.01', FinanceAccountType.Expense);
    const catExp = env.addCategory('Administrativo', FinanceCategoryType.Expense);
    env.addEntry({
      lines: [
        { type: Debit, amount: '500.00', accountId: exp, categoryId: catExp },
        { type: Credit, amount: '500.00', accountId: pay },
      ],
    });
    env.addEntry({
      lines: [
        { type: Credit, amount: '500.00', accountId: exp, categoryId: catExp },
        { type: Debit, amount: '500.00', accountId: pay },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.operatingExpenses).toBe(0);
    expect(dre.netResult).toBe(0);
  });

  it('5. a customer payment settlement does not count as revenue', async () => {
    const env = setup();
    const cash = env.addAccount('1.1.01', FinanceAccountType.Asset);
    const recv = env.addAccount('1.1.02', FinanceAccountType.Asset);
    // DEBIT cash / CREDIT receivable — both patrimonial.
    env.addEntry({
      lines: [
        { type: Debit, amount: '1000.00', accountId: cash },
        { type: Credit, amount: '1000.00', accountId: recv },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.grossRevenue).toBe(0);
    expect(dre.netResult).toBe(0);
  });

  it('6. a supplier payment settlement does not count as an expense', async () => {
    const env = setup();
    const cash = env.addAccount('1.1.01', FinanceAccountType.Asset);
    const pay = env.addAccount('2.1.01', FinanceAccountType.Liability);
    env.addEntry({
      lines: [
        { type: Debit, amount: '500.00', accountId: pay },
        { type: Credit, amount: '500.00', accountId: cash },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.operatingExpenses).toBe(0);
    expect(dre.netResult).toBe(0);
  });

  it('7. a transfer between accounts is excluded from the DRE', async () => {
    const env = setup();
    const cashA = env.addAccount('1.1.01', FinanceAccountType.Asset);
    const cashB = env.addAccount('1.1.03', FinanceAccountType.Asset);
    env.addEntry({
      lines: [
        { type: Debit, amount: '300.00', accountId: cashB },
        { type: Credit, amount: '300.00', accountId: cashA },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.grossRevenue).toBe(0);
    expect(dre.operatingExpenses).toBe(0);
    expect(dre.netResult).toBe(0);
  });

  it('8. a pure patrimonial entry (capital injection) is ignored', async () => {
    const env = setup();
    const cash = env.addAccount('1.1.01', FinanceAccountType.Asset);
    const equity = env.addAccount('2.3.01', FinanceAccountType.Equity);
    env.addEntry({
      lines: [
        { type: Debit, amount: '5000.00', accountId: cash },
        { type: Credit, amount: '5000.00', accountId: equity },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.netResult).toBe(0);
    expect(dre.classification.complete).toBe(true);
  });

  it('9. a cost line lands in Custos dos Serviços (service costs)', async () => {
    const env = setup();
    const pay = env.addAccount('2.1.01', FinanceAccountType.Liability);
    const cogs = env.addAccount('4.1.01', FinanceAccountType.CostOfGoodsSold);
    const catCost = env.addCategory('Freelancers', FinanceCategoryType.Cost);
    env.addEntry({
      lines: [
        { type: Debit, amount: '300.00', accountId: cogs, categoryId: catCost },
        { type: Credit, amount: '300.00', accountId: pay },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.serviceCosts).toBe(300);
    expect(dre.operatingExpenses).toBe(0);
    const costGroup = dre.groups.find((g: any) => g.key === 'service_costs');
    expect(costGroup.total).toBe(300);
  });

  it('10. an expense line lands in Despesas Operacionais (operating expenses)', async () => {
    const env = setup();
    const pay = env.addAccount('2.1.01', FinanceAccountType.Liability);
    const exp = env.addAccount('5.1.03', FinanceAccountType.Expense);
    const catExp = env.addCategory('Tráfego e Mídia', FinanceCategoryType.Expense);
    env.addEntry({
      lines: [
        { type: Debit, amount: '450.00', accountId: exp, categoryId: catExp },
        { type: Credit, amount: '450.00', accountId: pay },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.operatingExpenses).toBe(450);
    const expGroup = dre.groups.find((g: any) => g.key === 'operating_expenses');
    const comercial = expGroup.subgroups.find((s: any) => s.key === 'Comerciais');
    expect(comercial.total).toBe(450);
  });

  it('11. netResult = netRevenue - costs - expenses + financialResult, with tax deductions', async () => {
    const env = setup();
    const recv = env.addAccount('1.1.02', FinanceAccountType.Asset);
    const pay = env.addAccount('2.1.01', FinanceAccountType.Liability);
    const cash = env.addAccount('1.1.01', FinanceAccountType.Asset);
    const rev = env.addAccount('3.1.01', FinanceAccountType.Revenue);
    const cogs = env.addAccount('4.1.01', FinanceAccountType.CostOfGoodsSold);
    const exp = env.addAccount('5.1.01', FinanceAccountType.Expense);
    const fin = env.addAccount('3.2.01', FinanceAccountType.Revenue, {
      metadata: { dreGroup: 'financial_result' },
    });
    const catRev = env.addCategory('Mensalidade', FinanceCategoryType.Revenue);
    const catTax = env.addCategory('Impostos', FinanceCategoryType.Tax);
    const catCost = env.addCategory('Freelancers', FinanceCategoryType.Cost);
    const catExp = env.addCategory('Administrativo', FinanceCategoryType.Expense);

    env.addEntry({
      lines: [
        { type: Debit, amount: '1000.00', accountId: recv },
        { type: Credit, amount: '1000.00', accountId: rev, categoryId: catRev },
      ],
    });
    // Tax deduction on revenue (category.type = tax wins over expense account).
    env.addEntry({
      lines: [
        { type: Debit, amount: '100.00', accountId: exp, categoryId: catTax },
        { type: Credit, amount: '100.00', accountId: pay },
      ],
    });
    env.addEntry({
      lines: [
        { type: Debit, amount: '200.00', accountId: cogs, categoryId: catCost },
        { type: Credit, amount: '200.00', accountId: pay },
      ],
    });
    env.addEntry({
      lines: [
        { type: Debit, amount: '300.00', accountId: exp, categoryId: catExp },
        { type: Credit, amount: '300.00', accountId: pay },
      ],
    });
    // Financial income (e.g. interest received): DEBIT cash / CREDIT financial.
    env.addEntry({
      lines: [
        { type: Debit, amount: '50.00', accountId: cash },
        { type: Credit, amount: '50.00', accountId: fin },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.grossRevenue).toBe(1000);
    expect(dre.deductions).toBe(100);
    expect(dre.netRevenue).toBe(900);
    expect(dre.serviceCosts).toBe(200);
    expect(dre.grossProfit).toBe(700);
    expect(dre.operatingExpenses).toBe(300);
    expect(dre.operatingResult).toBe(400);
    expect(dre.financialResult).toBe(50);
    expect(dre.netResult).toBe(450);
    expect(dre.netMargin).toBe(0.5);
  });

  it('12. the period filter excludes out-of-range entries', async () => {
    const env = setup();
    const recv = env.addAccount('1.1.02', FinanceAccountType.Asset);
    const rev = env.addAccount('3.1.01', FinanceAccountType.Revenue);
    const catRev = env.addCategory('Mensalidade', FinanceCategoryType.Revenue);
    env.addEntry({
      entryDate: '2026-05-31',
      lines: [
        { type: Debit, amount: '1000.00', accountId: recv },
        { type: Credit, amount: '1000.00', accountId: rev, categoryId: catRev },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.grossRevenue).toBe(0);
  });

  it('12b. accrualDate (competência) overrides entryDate for bucketing', async () => {
    const env = setup();
    const recv = env.addAccount('1.1.02', FinanceAccountType.Asset);
    const rev = env.addAccount('3.1.01', FinanceAccountType.Revenue);
    const catRev = env.addCategory('Mensalidade', FinanceCategoryType.Revenue);
    // Posted in July, but competência is June.
    env.addEntry({
      entryDate: '2026-07-05',
      accrualDate: '2026-06-30',
      lines: [
        { type: Debit, amount: '800.00', accountId: recv },
        { type: Credit, amount: '800.00', accountId: rev, categoryId: catRev },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.grossRevenue).toBe(800);
  });

  it('13. entries from another tenant/workspace do not enter the DRE', async () => {
    const env = setup();
    const recv = env.addAccount('1.1.02', FinanceAccountType.Asset);
    const rev = env.addAccount('3.1.01', FinanceAccountType.Revenue);
    const catRev = env.addCategory('Mensalidade', FinanceCategoryType.Revenue);
    env.addEntry({
      tenantId: 'other-tenant',
      workspaceId: 'other-workspace',
      lines: [
        { type: Debit, amount: '9999.00', accountId: recv },
        { type: Credit, amount: '9999.00', accountId: rev, categoryId: catRev },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.grossRevenue).toBe(0);
  });

  it('14. lines without a category / without a DRE group raise classification alerts', async () => {
    const env = setup();
    const recv = env.addAccount('1.1.02', FinanceAccountType.Asset);
    const rev = env.addAccount('3.1.01', FinanceAccountType.Revenue);
    // Revenue line classified by account.type but missing a category.
    env.addEntry({
      lines: [
        { type: Debit, amount: '1000.00', accountId: recv },
        { type: Credit, amount: '1000.00', accountId: rev },
      ],
    });
    // A line with neither account nor category → truly unclassified.
    env.addEntry({
      lines: [
        { type: Debit, amount: '70.00' },
        { type: Credit, amount: '70.00', accountId: recv },
      ],
    });

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.grossRevenue).toBe(1000);
    expect(dre.classification.linesWithoutCategory).toBeGreaterThanOrEqual(1);
    expect(dre.classification.linesWithoutDreGroup).toBe(1);
    expect(dre.classification.amountUnclassified).toBe(70);
    expect(dre.classification.complete).toBe(false);
  });

  it('15. a period without data returns zeros and a clean classification', async () => {
    const env = setup();
    env.addAccount('3.1.01', FinanceAccountType.Revenue);

    const dre = (await env.service.getDre(ctx, JUNE)) as any;

    expect(dre.grossRevenue).toBe(0);
    expect(dre.netRevenue).toBe(0);
    expect(dre.serviceCosts).toBe(0);
    expect(dre.operatingExpenses).toBe(0);
    expect(dre.netResult).toBe(0);
    expect(dre.netMargin).toBe(0);
    expect(dre.classification.complete).toBe(true);
    expect(dre.groups).toHaveLength(5);
  });

  it('16. comparison returns the previous period summary when requested', async () => {
    const env = setup();
    const recv = env.addAccount('1.1.02', FinanceAccountType.Asset);
    const rev = env.addAccount('3.1.01', FinanceAccountType.Revenue);
    const catRev = env.addCategory('Mensalidade', FinanceCategoryType.Revenue);
    env.addEntry({
      entryDate: '2026-06-10',
      lines: [
        { type: Debit, amount: '1000.00', accountId: recv },
        { type: Credit, amount: '1000.00', accountId: rev, categoryId: catRev },
      ],
    });
    env.addEntry({
      entryDate: '2026-05-10',
      lines: [
        { type: Debit, amount: '400.00', accountId: recv },
        { type: Credit, amount: '400.00', accountId: rev, categoryId: catRev },
      ],
    });

    const dre = (await env.service.getDre(ctx, { ...JUNE, compare: true })) as any;

    expect(dre.grossRevenue).toBe(1000);
    expect(dre.comparison.period).toEqual({ startDate: '2026-05-02', endDate: '2026-05-31' });
    expect(dre.comparison.grossRevenue).toBe(400);
  });
});
