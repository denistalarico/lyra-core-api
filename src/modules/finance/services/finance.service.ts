import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  CreateFinanceAccountDto,
  CreateFinanceBankAccountDto,
  CreateFinanceCategoryDto,
  CreateFinanceCostCenterDto,
  CreateFinanceJournalDto,
  CreateFinanceTagDto,
  UpdateFinanceAccountDto,
  UpdateFinanceProfitabilityRulesDto,
  UpdateFinanceSettingsDto,
  FinanceMetricsHistoryQueryDto,
} from '../dto';
import {
  FinanceAccount,
  FinanceBankAccount,
  FinanceBill,
  FinanceCategory,
  FinanceCostCenter,
  FinanceInvoice,
  FinanceJournal,
  FinanceMetricSnapshot,
  FinanceProfitabilityRule,
  FinanceRecurringProfile,
  FinanceReportSnapshot,
  FinanceSetting,
  FinanceTag,
} from '../entities';
import { FinanceRequestContext } from './finance-context';

@Injectable()
export class FinanceService {
  constructor(
    @InjectRepository(FinanceSetting, 'agency')
    private readonly settingsRepo: Repository<FinanceSetting>,
    @InjectRepository(FinanceAccount, 'agency')
    private readonly accountsRepo: Repository<FinanceAccount>,
    @InjectRepository(FinanceJournal, 'agency')
    private readonly journalsRepo: Repository<FinanceJournal>,
    @InjectRepository(FinanceCategory, 'agency')
    private readonly categoriesRepo: Repository<FinanceCategory>,
    @InjectRepository(FinanceInvoice, 'agency')
    private readonly invoicesRepo: Repository<FinanceInvoice>,
    @InjectRepository(FinanceBill, 'agency')
    private readonly billsRepo: Repository<FinanceBill>,
    @InjectRepository(FinanceRecurringProfile, 'agency')
    private readonly recurringProfilesRepo: Repository<FinanceRecurringProfile>,
    @InjectRepository(FinanceTag, 'agency')
    private readonly tagsRepo: Repository<FinanceTag>,
    @InjectRepository(FinanceCostCenter, 'agency')
    private readonly costCentersRepo: Repository<FinanceCostCenter>,
    @InjectRepository(FinanceBankAccount, 'agency')
    private readonly bankAccountsRepo: Repository<FinanceBankAccount>,
    @InjectRepository(FinanceProfitabilityRule, 'agency')
    private readonly profitabilityRulesRepo: Repository<FinanceProfitabilityRule>,
    @InjectRepository(FinanceMetricSnapshot, 'agency')
    private readonly metricSnapshotsRepo: Repository<FinanceMetricSnapshot>,
    @InjectRepository(FinanceReportSnapshot, 'agency')
    private readonly reportSnapshotsRepo: Repository<FinanceReportSnapshot>,
  ) {}

  getHealth() {
    return {
      status: 'ok',
      module: 'agency-finance',
      scope: 'lyra-agency',
      areas: [
        'overview',
        'invoices',
        'bills',
        'payments',
        'customers',
        'vendors',
        'entries',
        'reports',
        'profitability',
        'settings',
      ],
      profitabilityInsideFinance: true,
    };
  }

  async getSettings(ctx: FinanceRequestContext) {
    let settings = await this.settingsRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!settings) {
      settings = this.settingsRepo.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      });

      settings = await this.settingsRepo.save(settings);
    }

    return settings;
  }

  async updateSettings(
    ctx: FinanceRequestContext,
    dto: UpdateFinanceSettingsDto,
  ) {
    const settings = await this.getSettings(ctx);
    Object.assign(settings, dto);
    return this.settingsRepo.save(settings);
  }

  listAccounts(ctx: FinanceRequestContext) {
    return this.accountsRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: {
        code: 'ASC',
        name: 'ASC',
      },
    });
  }

  createAccount(ctx: FinanceRequestContext, dto: CreateFinanceAccountDto) {
    const account = this.accountsRepo.create({
      ...dto,
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      status: dto.status,
    });

    return this.accountsRepo.save(account);
  }

  async updateAccount(
    ctx: FinanceRequestContext,
    id: string,
    dto: UpdateFinanceAccountDto,
  ) {
    const account = await this.accountsRepo.findOne({
      where: {
        id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!account) {
      throw new NotFoundException('Finance account not found');
    }

    Object.assign(account, dto);
    return this.accountsRepo.save(account);
  }

  listJournals(ctx: FinanceRequestContext) {
    return this.journalsRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: {
        code: 'ASC',
      },
    });
  }

  createJournal(ctx: FinanceRequestContext, dto: CreateFinanceJournalDto) {
    const journal = this.journalsRepo.create({
      ...dto,
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
    });

    return this.journalsRepo.save(journal);
  }

  listCategories(ctx: FinanceRequestContext) {
    return this.categoriesRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: {
        type: 'ASC',
        name: 'ASC',
      },
    });
  }

  createCategory(ctx: FinanceRequestContext, dto: CreateFinanceCategoryDto) {
    const category = this.categoriesRepo.create({
      ...dto,
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
    });

    return this.categoriesRepo.save(category);
  }

  listTags(ctx: FinanceRequestContext) {
    return this.tagsRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: {
        name: 'ASC',
      },
    });
  }

  createTag(ctx: FinanceRequestContext, dto: CreateFinanceTagDto) {
    const tag = this.tagsRepo.create({
      ...dto,
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
    });

    return this.tagsRepo.save(tag);
  }

  listCostCenters(ctx: FinanceRequestContext) {
    return this.costCentersRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: {
        type: 'ASC',
        name: 'ASC',
      },
    });
  }

  createCostCenter(
    ctx: FinanceRequestContext,
    dto: CreateFinanceCostCenterDto,
  ) {
    const costCenter = this.costCentersRepo.create({
      ...dto,
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
    });

    return this.costCentersRepo.save(costCenter);
  }

  listBankAccounts(ctx: FinanceRequestContext) {
    return this.bankAccountsRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: {
        name: 'ASC',
      },
    });
  }

  createBankAccount(
    ctx: FinanceRequestContext,
    dto: CreateFinanceBankAccountDto,
  ) {
    const bankAccount = this.bankAccountsRepo.create({
      ...dto,
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
    });

    return this.bankAccountsRepo.save(bankAccount);
  }

  async getProfitabilityRules(ctx: FinanceRequestContext) {
    let rules = await this.profitabilityRulesRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!rules) {
      rules = this.profitabilityRulesRepo.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      });

      rules = await this.profitabilityRulesRepo.save(rules);
    }

    return rules;
  }

  async updateProfitabilityRules(
    ctx: FinanceRequestContext,
    dto: UpdateFinanceProfitabilityRulesDto,
  ) {
    const rules = await this.getProfitabilityRules(ctx);
    Object.assign(rules, dto);
    return this.profitabilityRulesRepo.save(rules);
  }

  async getReportsOverview(ctx: FinanceRequestContext) {
    const settings = await this.getSettings(ctx);

    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    );

    const periodStartDate = periodStart.toISOString().slice(0, 10);
    const periodEndDate = periodEnd.toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);

    const [
      invoices,
      bills,
      recurringProfiles,
      categories,
      metricsCount,
      reportsCount,
    ] = await Promise.all([
      this.invoicesRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      }),
      this.billsRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      }),
      this.recurringProfilesRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      }),
      this.categoriesRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      }),
      this.metricSnapshotsRepo.count({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      }),
      this.reportSnapshotsRepo.count({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      }),
    ]);

    const categoriesById = new Map(
      categories.map((category) => [category.id, category]),
    );

    const monthInvoices = invoices.filter((invoice) => {
      const date =
        invoice.issueDate ?? invoice.createdAt.toISOString().slice(0, 10);
      return date >= periodStartDate && date <= periodEndDate;
    });

    const monthBills = bills.filter((bill) => {
      const date = bill.issueDate ?? bill.createdAt.toISOString().slice(0, 10);
      return date >= periodStartDate && date <= periodEndDate;
    });

    const validInvoices = invoices.filter(
      (invoice) => !['cancelled', 'void'].includes(invoice.status),
    );

    const validMonthInvoices = monthInvoices.filter(
      (invoice) => !['cancelled', 'void'].includes(invoice.status),
    );

    const validBills = bills.filter((bill) => bill.status !== 'cancelled');

    const validMonthBills = monthBills.filter(
      (bill) => bill.status !== 'cancelled',
    );

    const activeRecurringProfiles = recurringProfiles.filter(
      (profile) => profile.status === 'active',
    );

    const mrr = activeRecurringProfiles
      .filter((profile) => profile.interval === 'monthly')
      .reduce((sum, profile) => sum + this.toNumber(profile.amount), 0);

    const revenueIssued = validMonthInvoices.reduce(
      (sum, invoice) => sum + this.toNumber(invoice.totalAmount),
      0,
    );

    const revenueReceived = validMonthInvoices.reduce(
      (sum, invoice) => sum + this.toNumber(invoice.paidAmount),
      0,
    );

    const openReceivables = validInvoices.reduce(
      (sum, invoice) => sum + this.toNumber(invoice.balanceDue),
      0,
    );

    const overdueReceivables = validInvoices
      .filter((invoice) => {
        if (!invoice.dueDate) return false;
        if (this.toNumber(invoice.balanceDue) <= 0) return false;
        return invoice.dueDate < today;
      })
      .reduce((sum, invoice) => sum + this.toNumber(invoice.balanceDue), 0);

    const totalReceivableBalance = validInvoices.reduce(
      (sum, invoice) => sum + this.toNumber(invoice.totalAmount),
      0,
    );

    const defaultRate =
      totalReceivableBalance > 0
        ? overdueReceivables / totalReceivableBalance
        : 0;

    const averageTicket =
      validMonthInvoices.length > 0
        ? revenueIssued / validMonthInvoices.length
        : 0;

    const fixedCosts = validMonthBills
      .filter((bill) => {
        if (!bill.categoryId) return false;
        return categoriesById.get(bill.categoryId)?.costBehavior === 'fixed';
      })
      .reduce((sum, bill) => sum + this.toNumber(bill.totalAmount), 0);

    const variableCosts = validMonthBills
      .filter((bill) => {
        if (!bill.categoryId) return true;
        const behavior = categoriesById.get(bill.categoryId)?.costBehavior;
        return behavior === 'variable' || behavior === 'mixed' || !behavior;
      })
      .reduce((sum, bill) => sum + this.toNumber(bill.totalAmount), 0);

    const totalCosts = fixedCosts + variableCosts;

    const grossMargin =
      revenueIssued > 0 ? (revenueIssued - variableCosts) / revenueIssued : 0;

    const netMargin =
      revenueIssued > 0 ? (revenueIssued - totalCosts) / revenueIssued : 0;

    const breakEvenPoint =
      grossMargin > 0 ? fixedCosts / grossMargin : fixedCosts;

    const activeContracts = activeRecurringProfiles.length;

    return {
      currency: settings.baseCurrency,
      period: {
        type: 'monthly',
        start: periodStartDate,
        end: periodEndDate,
      },
      snapshots: {
        metrics: metricsCount,
        reports: reportsCount,
      },
      cards: {
        mrr: this.roundMoney(mrr),
        revenueIssued: this.roundMoney(revenueIssued),
        revenueReceived: this.roundMoney(revenueReceived),
        openReceivables: this.roundMoney(openReceivables),
        overdueReceivables: this.roundMoney(overdueReceivables),
        defaultRate: this.roundRate(defaultRate),
        averageTicket: this.roundMoney(averageTicket),
        fixedCosts: this.roundMoney(fixedCosts),
        variableCosts: this.roundMoney(variableCosts),
        grossMargin: this.roundRate(grossMargin),
        netMargin: this.roundRate(netMargin),
        breakEvenPoint: this.roundMoney(breakEvenPoint),
        activeContracts,
        customerChurn: 0,
        revenueChurn: 0,
      },
      counts: {
        invoices: validInvoices.length,
        monthInvoices: validMonthInvoices.length,
        bills: validBills.length,
        monthBills: validMonthBills.length,
        recurringProfiles: recurringProfiles.length,
        activeRecurringProfiles: activeRecurringProfiles.length,
      },
      status: 'calculated',
    };
  }



  async getMetricsHistory(
    ctx: FinanceRequestContext,
    query: FinanceMetricsHistoryQueryDto,
  ) {
    const qb = this.metricSnapshotsRepo
      .createQueryBuilder('metric')
      .where('metric.tenant_id = :tenantId', { tenantId: ctx.tenantId })
      .andWhere('metric.workspace_id = :workspaceId', {
        workspaceId: ctx.workspaceId,
      });

    if (query.metricKey) {
      qb.andWhere('metric.metric_key = :metricKey', {
        metricKey: query.metricKey,
      });
    }

    if (query.periodType) {
      qb.andWhere('metric.period_type = :periodType', {
        periodType: query.periodType,
      });
    }

    if (query.startDate) {
      qb.andWhere('metric.period_start >= :startDate', {
        startDate: query.startDate,
      });
    }

    if (query.endDate) {
      qb.andWhere('metric.period_end <= :endDate', {
        endDate: query.endDate,
      });
    }

    const rows = await qb
      .orderBy('metric.period_start', 'ASC')
      .addOrderBy('metric.metric_key', 'ASC')
      .getMany();

    return {
      status: 'ok',
      module: 'agency-finance',
      filters: {
        metricKey: query.metricKey ?? null,
        periodType: query.periodType ?? null,
        startDate: query.startDate ?? null,
        endDate: query.endDate ?? null,
      },
      total: rows.length,
      data: rows.map((row) => ({
        id: row.id,
        metricKey: row.metricKey,
        periodType: row.periodType,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        value: Number(row.value),
        currency: row.currency,
        source: row.source,
        calculatedAt: row.calculatedAt,
        metadata: row.metadata,
      })),
    };
  }

  async createMonthlyReportSnapshot(ctx: FinanceRequestContext) {
    const overview = await this.getReportsOverview(ctx);
    const calculatedAt = new Date();

    const periodStart = overview.period.start;
    const periodEnd = overview.period.end;
    const periodType = 'monthly';

    const cards = overview.cards;

    const metricEntries = [
      ['mrr', cards.mrr],
      ['revenue_issued', cards.revenueIssued],
      ['revenue_received', cards.revenueReceived],
      ['open_receivables', cards.openReceivables],
      ['overdue_receivables', cards.overdueReceivables],
      ['default_rate', cards.defaultRate],
      ['average_ticket', cards.averageTicket],
      ['fixed_costs', cards.fixedCosts],
      ['variable_costs', cards.variableCosts],
      ['gross_margin', cards.grossMargin],
      ['net_margin', cards.netMargin],
      ['break_even_point', cards.breakEvenPoint],
      ['active_contracts', cards.activeContracts],
      ['customer_churn', cards.customerChurn],
      ['revenue_churn', cards.revenueChurn],
    ] as const;

    const metricKeys = metricEntries.map(([metricKey]) => metricKey);

    await this.metricSnapshotsRepo.delete({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      periodType: periodType as FinanceMetricSnapshot['periodType'],
      periodStart,
      periodEnd,
      metricKey: In(metricKeys as unknown as FinanceMetricSnapshot['metricKey'][]),
    });

    await this.reportSnapshotsRepo.delete({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      periodType: periodType as FinanceReportSnapshot['periodType'],
      periodStart,
      periodEnd,
      reportType: 'executive' as FinanceReportSnapshot['reportType'],
    });

    const metricSnapshots = metricEntries.map(([metricKey, value]) =>
      this.metricSnapshotsRepo.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        metricKey: metricKey as FinanceMetricSnapshot['metricKey'],
        periodType: periodType as FinanceMetricSnapshot['periodType'],
        periodStart,
        periodEnd,
        value: String(value ?? 0),
        currency: overview.currency,
        source: 'monthly_snapshot',
        metadata: {
          generatedBy: ctx.userId,
          status: overview.status,
        },
        calculatedAt,
      }),
    );

    const savedMetrics = await this.metricSnapshotsRepo.save(metricSnapshots);

    const reportSnapshot = await this.reportSnapshotsRepo.save(
      this.reportSnapshotsRepo.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        reportType: 'executive' as FinanceReportSnapshot['reportType'],
        periodType: periodType as FinanceReportSnapshot['periodType'],
        periodStart,
        periodEnd,
        payload: overview,
        calculatedAt,
      }),
    );

    return {
      status: 'ok',
      module: 'agency-finance',
      snapshot: {
        periodType,
        periodStart,
        periodEnd,
        calculatedAt,
        metrics: savedMetrics.length,
        reportSnapshotId: reportSnapshot.id,
      },
      overview,
    };
  }

  private toNumber(value: string | number | null | undefined): number {
    if (value === null || value === undefined || value === '') return 0;

    const parsed = Number(value);

    if (Number.isNaN(parsed)) return 0;

    return parsed;
  }

  private roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private roundRate(value: number): number {
    return Math.round(value * 10000) / 10000;
  }
}
