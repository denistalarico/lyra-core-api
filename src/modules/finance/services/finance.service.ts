import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
} from '../dto';
import {
  FinanceAccount,
  FinanceBankAccount,
  FinanceCategory,
  FinanceCostCenter,
  FinanceJournal,
  FinanceMetricSnapshot,
  FinanceProfitabilityRule,
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
    const [metricsCount, reportsCount] = await Promise.all([
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

    return {
      currency: (await this.getSettings(ctx)).baseCurrency,
      snapshots: {
        metrics: metricsCount,
        reports: reportsCount,
      },
      cards: {
        mrr: 0,
        revenueIssued: 0,
        revenueReceived: 0,
        overdueReceivables: 0,
        defaultRate: 0,
        averageTicket: 0,
        fixedCosts: 0,
        variableCosts: 0,
        grossMargin: 0,
        netMargin: 0,
        breakEvenPoint: 0,
        activeContracts: 0,
        customerChurn: 0,
        revenueChurn: 0,
      },
      status: 'foundation_ready',
    };
  }
}
