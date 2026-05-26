import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  FinanceAccountStatus,
  FinanceAccountType,
  FinanceBankAccountType,
  FinanceCategoryType,
  FinanceCostBehavior,
  FinanceCostCenterType,
  FinanceJournalType,
} from '../enums';
import {
  FinanceAccount,
  FinanceBankAccount,
  FinanceCategory,
  FinanceCostCenter,
  FinanceJournal,
  FinanceProfitabilityRule,
  FinanceSetting,
  FinanceTag,
} from '../entities';
import { FinanceRequestContext } from './finance-context';

@Injectable()
export class FinanceDefaultsService {
  constructor(
    @InjectRepository(FinanceSetting, 'agency')
    private readonly settingsRepo: Repository<FinanceSetting>,

    @InjectRepository(FinanceProfitabilityRule, 'agency')
    private readonly profitabilityRulesRepo: Repository<FinanceProfitabilityRule>,

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
  ) {}

  async setupDefaults(ctx: FinanceRequestContext) {
    const created: string[] = [];
    const existing: string[] = [];

    await this.ensureSettings(ctx, created, existing);
    await this.ensureProfitabilityRules(ctx, created, existing);

    await this.ensureAccounts(ctx, created, existing);
    await this.ensureJournals(ctx, created, existing);
    await this.ensureCategories(ctx, created, existing);
    await this.ensureTags(ctx, created, existing);
    await this.ensureCostCenters(ctx, created, existing);
    await this.ensureBankAccounts(ctx, created, existing);

    return {
      status: 'ok',
      module: 'agency-finance',
      setup: 'defaults',
      created,
      existing,
      summary: {
        created: created.length,
        existing: existing.length,
      },
    };
  }

  private async ensureSettings(
    ctx: FinanceRequestContext,
    created: string[],
    existing: string[],
  ) {
    const found = await this.settingsRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (found) {
      existing.push('finance_settings');
      return found;
    }

    const item = this.settingsRepo.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      baseCurrency: 'BRL',
      fiscalCountry: 'BR',
      fiscalLocalization: 'br_agency_simplified',
      defaultPaymentTermsDays: 7,
      invoiceTerms:
        'Pagamento conforme condições acordadas. Em caso de atraso, poderão ser aplicados encargos conforme contrato.',
      pixEnabled: false,
      autoGenerateRecurringInvoices: false,
      gracePeriodDays: 3,
    });

    created.push('finance_settings');
    return this.settingsRepo.save(item);
  }

  private async ensureProfitabilityRules(
    ctx: FinanceRequestContext,
    created: string[],
    existing: string[],
  ) {
    const found = await this.profitabilityRulesRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (found) {
      existing.push('finance_profitability_rules');
      return found;
    }

    const item = this.profitabilityRulesRepo.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      defaultHourlyCost: '35.00',
      healthyMarginThreshold: '0.4000',
      attentionMarginThreshold: '0.2000',
      riskMarginThreshold: '0.0000',
      overheadAllocationMethod: 'revenue_share',
      includeFixedCostsInClientMargin: true,
      includeTeamTimeCosts: true,
    });

    created.push('finance_profitability_rules');
    return this.profitabilityRulesRepo.save(item);
  }

  private async ensureAccounts(
    ctx: FinanceRequestContext,
    created: string[],
    existing: string[],
  ) {
    const defaults: Array<Partial<FinanceAccount>> = [
      {
        code: '1.1.01',
        name: 'Caixa e Bancos',
        type: FinanceAccountType.Asset,
      },
      {
        code: '1.1.02',
        name: 'Contas a Receber',
        type: FinanceAccountType.Asset,
      },
      {
        code: '2.1.01',
        name: 'Contas a Pagar',
        type: FinanceAccountType.Liability,
      },
      {
        code: '2.1.02',
        name: 'Impostos a Recolher',
        type: FinanceAccountType.Liability,
      },
      {
        code: '3.1.01',
        name: 'Receita de Serviços',
        type: FinanceAccountType.Revenue,
      },
      {
        code: '3.1.02',
        name: 'Receita Recorrente',
        type: FinanceAccountType.Revenue,
      },
      {
        code: '3.1.03',
        name: 'Receita de Setup e Projetos',
        type: FinanceAccountType.Revenue,
      },
      {
        code: '4.1.01',
        name: 'Custos Diretos de Entrega',
        type: FinanceAccountType.CostOfGoodsSold,
      },
      {
        code: '5.1.01',
        name: 'Despesas Operacionais',
        type: FinanceAccountType.Expense,
      },
      {
        code: '5.1.02',
        name: 'Ferramentas e Softwares',
        type: FinanceAccountType.Expense,
      },
      {
        code: '5.1.03',
        name: 'Marketing e Vendas',
        type: FinanceAccountType.Expense,
      },
      {
        code: '5.1.04',
        name: 'Administrativo',
        type: FinanceAccountType.Expense,
      },
    ];

    for (const account of defaults) {
      const found = await this.accountsRepo.findOne({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          code: account.code!,
        },
      });

      if (found) {
        existing.push(`finance_accounts:${account.code}`);
        continue;
      }

      await this.accountsRepo.save(
        this.accountsRepo.create({
          ...account,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          status: FinanceAccountStatus.Active,
          isSystem: true,
        }),
      );

      created.push(`finance_accounts:${account.code}`);
    }
  }

  private async ensureJournals(
    ctx: FinanceRequestContext,
    created: string[],
    existing: string[],
  ) {
    const defaults: Array<Partial<FinanceJournal>> = [
      {
        name: 'Diário de Vendas',
        code: 'SALES',
        type: FinanceJournalType.Sales,
      },
      {
        name: 'Diário de Compras',
        code: 'PURCHASE',
        type: FinanceJournalType.Purchase,
      },
      {
        name: 'Banco',
        code: 'BANK',
        type: FinanceJournalType.Bank,
      },
      {
        name: 'Caixa',
        code: 'CASH',
        type: FinanceJournalType.Cash,
      },
      {
        name: 'Lançamentos Diversos',
        code: 'MISC',
        type: FinanceJournalType.Miscellaneous,
      },
    ];

    for (const journal of defaults) {
      const found = await this.journalsRepo.findOne({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          code: journal.code!,
        },
      });

      if (found) {
        existing.push(`finance_journals:${journal.code}`);
        continue;
      }

      await this.journalsRepo.save(
        this.journalsRepo.create({
          ...journal,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          active: true,
        }),
      );

      created.push(`finance_journals:${journal.code}`);
    }
  }

  private async ensureCategories(
    ctx: FinanceRequestContext,
    created: string[],
    existing: string[],
  ) {
    const defaults: Array<Partial<FinanceCategory>> = [
      {
        name: 'Mensalidade Recorrente',
        type: FinanceCategoryType.Revenue,
        color: '#16A34A',
      },
      {
        name: 'Setup e Implantação',
        type: FinanceCategoryType.Revenue,
        color: '#0EA5E9',
      },
      {
        name: 'Projeto Avulso',
        type: FinanceCategoryType.Revenue,
        color: '#2563EB',
      },
      {
        name: 'Freelancers e Terceiros',
        type: FinanceCategoryType.Cost,
        costBehavior: FinanceCostBehavior.Variable,
        color: '#F59E0B',
      },
      {
        name: 'Ferramentas e Softwares',
        type: FinanceCategoryType.Expense,
        costBehavior: FinanceCostBehavior.Fixed,
        color: '#7C3AED',
      },
      {
        name: 'Tráfego e Mídia',
        type: FinanceCategoryType.Expense,
        costBehavior: FinanceCostBehavior.Variable,
        color: '#DC2626',
      },
      {
        name: 'Impostos e Taxas',
        type: FinanceCategoryType.Tax,
        costBehavior: FinanceCostBehavior.Variable,
        color: '#64748B',
      },
      {
        name: 'Administrativo',
        type: FinanceCategoryType.Expense,
        costBehavior: FinanceCostBehavior.Fixed,
        color: '#0F172A',
      },
    ];

    for (const category of defaults) {
      const found = await this.categoriesRepo.findOne({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          name: category.name!,
          type: category.type!,
        },
      });

      if (found) {
        existing.push(`finance_categories:${category.name}`);
        continue;
      }

      await this.categoriesRepo.save(
        this.categoriesRepo.create({
          ...category,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          active: true,
        }),
      );

      created.push(`finance_categories:${category.name}`);
    }
  }

  private async ensureTags(
    ctx: FinanceRequestContext,
    created: string[],
    existing: string[],
  ) {
    const defaults: Array<Partial<FinanceTag>> = [
      {
        name: 'Recorrente',
        color: '#16A34A',
      },
      {
        name: 'Pontual',
        color: '#2563EB',
      },
      {
        name: 'Fixo',
        color: '#7C3AED',
      },
      {
        name: 'Variável',
        color: '#F59E0B',
      },
      {
        name: 'Cliente',
        color: '#0EA5E9',
      },
      {
        name: 'Interno',
        color: '#64748B',
      },
    ];

    for (const tag of defaults) {
      const found = await this.tagsRepo.findOne({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          name: tag.name!,
        },
      });

      if (found) {
        existing.push(`finance_tags:${tag.name}`);
        continue;
      }

      await this.tagsRepo.save(
        this.tagsRepo.create({
          ...tag,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          active: true,
        }),
      );

      created.push(`finance_tags:${tag.name}`);
    }
  }

  private async ensureCostCenters(
    ctx: FinanceRequestContext,
    created: string[],
    existing: string[],
  ) {
    const defaults: Array<Partial<FinanceCostCenter>> = [
      {
        name: 'Operação Interna',
        type: FinanceCostCenterType.Internal,
      },
      {
        name: 'Comercial',
        type: FinanceCostCenterType.Commercial,
      },
      {
        name: 'Administrativo',
        type: FinanceCostCenterType.Administrative,
      },
      {
        name: 'Projetos de Clientes',
        type: FinanceCostCenterType.Project,
      },
    ];

    for (const costCenter of defaults) {
      const found = await this.costCentersRepo.findOne({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          name: costCenter.name!,
          type: costCenter.type!,
        },
      });

      if (found) {
        existing.push(`finance_cost_centers:${costCenter.name}`);
        continue;
      }

      await this.costCentersRepo.save(
        this.costCentersRepo.create({
          ...costCenter,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          active: true,
        }),
      );

      created.push(`finance_cost_centers:${costCenter.name}`);
    }
  }

  private async ensureBankAccounts(
    ctx: FinanceRequestContext,
    created: string[],
    existing: string[],
  ) {
    const found = await this.bankAccountsRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        name: 'Conta Principal',
      },
    });

    if (found) {
      existing.push('finance_bank_accounts:Conta Principal');
      return;
    }

    await this.bankAccountsRepo.save(
      this.bankAccountsRepo.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        name: 'Conta Principal',
        type: FinanceBankAccountType.Checking,
        currency: 'BRL',
        bankName: null,
        externalReference: null,
        openingBalance: '0',
        active: true,
      }),
    );

    created.push('finance_bank_accounts:Conta Principal');
  }
}
