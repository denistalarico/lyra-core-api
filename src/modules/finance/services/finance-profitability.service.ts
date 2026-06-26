import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AgencyProject,
  AgencyProjectSettings,
  AgencyTask,
  AgencyTaskTimeEntry,
} from '../../projects/entities';
import {
  FinanceBill,
  FinanceInvoice,
  FinanceProfitabilityRule,
  FinanceRecurringProfile,
  FinanceSetting,
} from '../entities';
import { FinanceRequestContext } from './finance-context';

type ProfitabilityHealth =
  | 'healthy'
  | 'attention'
  | 'risk'
  | 'loss'
  | 'no_revenue';

type ProfitabilityItem = {
  id: string;
  name: string;
  clientId: string | null;
  revenue: number;
  recurringRevenue: number;
  invoicedRevenue: number;
  directCosts: number;
  laborMinutes: number;
  laborHours: number;
  laborCost: number;
  grossProfit: number;
  margin: number;
  health: ProfitabilityHealth;
  tasks: number;
};

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;

  const parsed = Number(value);

  if (Number.isNaN(parsed)) return 0;

  return parsed;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundRate(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function getMetadataString(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null {
  if (!metadata) return null;

  for (const key of keys) {
    const value = metadata[key];

    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return null;
}

@Injectable()
export class FinanceProfitabilityService {
  constructor(
    @InjectRepository(FinanceSetting, 'agency')
    private readonly settingsRepo: Repository<FinanceSetting>,

    @InjectRepository(FinanceProfitabilityRule, 'agency')
    private readonly rulesRepo: Repository<FinanceProfitabilityRule>,

    @InjectRepository(FinanceInvoice, 'agency')
    private readonly invoicesRepo: Repository<FinanceInvoice>,

    @InjectRepository(FinanceBill, 'agency')
    private readonly billsRepo: Repository<FinanceBill>,

    @InjectRepository(FinanceRecurringProfile, 'agency')
    private readonly recurringProfilesRepo: Repository<FinanceRecurringProfile>,

    @InjectRepository(AgencyProject, 'agency')
    private readonly projectsRepo: Repository<AgencyProject>,

    @InjectRepository(AgencyTask, 'agency')
    private readonly tasksRepo: Repository<AgencyTask>,

    @InjectRepository(AgencyTaskTimeEntry, 'agency')
    private readonly timeEntriesRepo: Repository<AgencyTaskTimeEntry>,

    @InjectRepository(AgencyProjectSettings, 'agency')
    private readonly projectSettingsRepo: Repository<AgencyProjectSettings>,
  ) {}

  async getOverview(ctx: FinanceRequestContext) {
    const now = new Date();
    const periodStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const periodEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    );

    const periodStartDate = periodStart.toISOString().slice(0, 10);
    const periodEndDate = periodEnd.toISOString().slice(0, 10);

    const [
      settings,
      rules,
      projects,
      tasks,
      timeEntries,
      invoices,
      bills,
      recurringProfiles,
    ] = await Promise.all([
      this.getSettings(ctx),
      this.getRules(ctx),
      this.projectsRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      }),
      this.tasksRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      }),
      this.timeEntriesRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      }),
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
    ]);

    const defaultHourlyCost = toNumber(rules.defaultHourlyCost);
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const tasksByProjectId = this.groupTasksByProject(tasks);
    const timeByProjectId = this.calculateTimeByProject(tasks, timeEntries);
    const timeByClientId = this.calculateTimeByClient(tasks, timeEntries);

    const validInvoices = invoices.filter(
      (invoice) => !['cancelled', 'void'].includes(String(invoice.status)),
    );

    const periodInvoices = validInvoices.filter((invoice) => {
      const date = invoice.issueDate ?? invoice.createdAt.toISOString().slice(0, 10);
      return date >= periodStartDate && date <= periodEndDate;
    });

    const validBills = bills.filter(
      (bill) => String(bill.status) !== 'cancelled',
    );

    const periodBills = validBills.filter((bill) => {
      const date = bill.issueDate ?? bill.createdAt.toISOString().slice(0, 10);
      return date >= periodStartDate && date <= periodEndDate;
    });

    const activeRecurringProfiles = recurringProfiles.filter(
      (profile) => String(profile.status) === 'active',
    );

    const projectsProfitability = projects.map((project) => {
      const projectTasks = tasksByProjectId.get(project.id) ?? [];
      const laborMinutes = timeByProjectId.get(project.id) ?? 0;
      const laborHours = laborMinutes / 60;
      const laborCost = laborHours * defaultHourlyCost;

      const invoicedRevenue = this.sumProjectInvoiceRevenue(
        project.id,
        periodInvoices,
      );

      const recurringRevenue = this.sumProjectRecurringRevenue(
        project.id,
        activeRecurringProfiles,
      );

      const directCosts = this.sumProjectDirectCosts(project.id, periodBills);

      return this.buildItem({
        id: project.id,
        name: project.name,
        clientId: project.clientId ?? null,
        revenue: invoicedRevenue + recurringRevenue,
        invoicedRevenue,
        recurringRevenue,
        directCosts,
        laborMinutes,
        laborCost,
        tasks: projectTasks.length,
        rules,
      });
    });

    const clientIds = Array.from(
      new Set(
        [
          ...projects.map((project) => project.clientId),
          ...tasks.map((task) => task.clientId),
          ...periodInvoices.map((invoice) => invoice.customerId),
          ...activeRecurringProfiles.map((profile) => profile.customerId),
        ].filter(Boolean) as string[],
      ),
    );

    const clientsProfitability = clientIds.map((clientId) => {
      const clientProjects = projects.filter(
        (project) => project.clientId === clientId,
      );

      const clientTasks = tasks.filter((task) => task.clientId === clientId);

      const laborMinutes = timeByClientId.get(clientId) ?? 0;
      const laborHours = laborMinutes / 60;
      const laborCost = laborHours * defaultHourlyCost;

      const invoicedRevenue = this.sumClientInvoiceRevenue(
        clientId,
        periodInvoices,
      );

      const recurringRevenue = this.sumClientRecurringRevenue(
        clientId,
        activeRecurringProfiles,
      );

      const directCosts = this.sumClientDirectCosts(clientId, periodBills);

      return this.buildItem({
        id: clientId,
        name: `Cliente ${clientId.slice(0, 8)}`,
        clientId,
        revenue: invoicedRevenue + recurringRevenue,
        invoicedRevenue,
        recurringRevenue,
        directCosts,
        laborMinutes,
        laborCost,
        tasks: clientTasks.length,
        rules,
        metadata: {
          projects: clientProjects.length,
        },
      });
    });

    const totals = this.calculateTotals(projectsProfitability);

    return {
      status: 'ok',
      module: 'agency-finance',
      area: 'profitability',
      currency: settings.baseCurrency,
      period: {
        type: 'monthly',
        start: periodStartDate,
        end: periodEndDate,
      },
      rules: {
        defaultHourlyCost,
        healthyMarginThreshold: toNumber(rules.healthyMarginThreshold),
        attentionMarginThreshold: toNumber(rules.attentionMarginThreshold),
        riskMarginThreshold: toNumber(rules.riskMarginThreshold),
        overheadAllocationMethod: rules.overheadAllocationMethod,
        includeFixedCostsInClientMargin: rules.includeFixedCostsInClientMargin,
        includeTeamTimeCosts: rules.includeTeamTimeCosts,
      },
      summary: {
        projects: projects.length,
        clients: clientIds.length,
        tasks: tasks.length,
        timeEntries: timeEntries.length,
        laborMinutes: totals.laborMinutes,
        laborHours: roundMoney(totals.laborHours),
        revenue: roundMoney(totals.revenue),
        invoicedRevenue: roundMoney(totals.invoicedRevenue),
        recurringRevenue: roundMoney(totals.recurringRevenue),
        directCosts: roundMoney(totals.directCosts),
        laborCost: roundMoney(totals.laborCost),
        grossProfit: roundMoney(totals.grossProfit),
        margin: roundRate(totals.margin),
        health: this.resolveHealth(totals.margin, totals.revenue, totals.grossProfit, rules),
      },
      projects: projectsProfitability,
      clients: clientsProfitability,
      notes: [
        'Revenue is linked by invoice/recurring sourceModule+sourceId or customerId.',
        'Labor cost uses task time entries first; if a task has no time entries, trackedMinutes is used as fallback.',
        'Direct costs use bill metadata projectId/clientId when available.',
      ],
      debug: {
        invoicesInPeriod: periodInvoices.length,
        billsInPeriod: periodBills.length,
        recurringProfilesActive: activeRecurringProfiles.length,
        tasksKnownById: tasksById.size,
      },
    };
  }


  async getProjectDetail(ctx: FinanceRequestContext, projectId: string) {
    const overview = await this.getOverview(ctx);
    const project = overview.projects.find((item) => item.id === projectId);

    if (!project) {
      return {
        status: 'not_found',
        module: 'agency-finance',
        area: 'profitability',
        type: 'project',
        id: projectId,
        message: 'Project profitability not found for this workspace.',
      };
    }

    return {
      status: 'ok',
      module: 'agency-finance',
      area: 'profitability',
      type: 'project',
      currency: overview.currency,
      period: overview.period,
      rules: overview.rules,
      project,
      notes: overview.notes,
    };
  }

  async getClientDetail(ctx: FinanceRequestContext, clientId: string) {
    const overview = await this.getOverview(ctx);
    const client = overview.clients.find((item) => item.id === clientId);

    if (!client) {
      return {
        status: 'not_found',
        module: 'agency-finance',
        area: 'profitability',
        type: 'client',
        id: clientId,
        message: 'Client profitability not found for this workspace.',
      };
    }

    const projects = overview.projects.filter(
      (project) => project.clientId === clientId,
    );

    const hoursByTaskType = await this.getClientHoursByTaskType(ctx, clientId);

    return {
      status: 'ok',
      module: 'agency-finance',
      area: 'profitability',
      type: 'client',
      currency: overview.currency,
      period: overview.period,
      rules: overview.rules,
      client,
      projects,
      hoursByTaskType,
      notes: overview.notes,
    };
  }

  // Hours spent on a client's tasks grouped by task type (the "horas por tipo
  // de tarefa" breakdown). Time comes from task time entries, falling back to
  // each task's trackedMinutes, mirroring the labor-cost calculation. Task type
  // ids are resolved to readable names from the workspace project settings.
  private async getClientHoursByTaskType(
    ctx: FinanceRequestContext,
    clientId: string,
  ): Promise<Array<{ taskType: string; minutes: number; hours: number }>> {
    const [tasks, settings] = await Promise.all([
      this.tasksRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          clientId,
        },
      }),
      this.projectSettingsRepo.findOne({
        where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      }),
    ]);

    if (tasks.length === 0) return [];

    const taskIds = tasks.map((task) => task.id);
    const timeEntries = await this.timeEntriesRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        taskId: In(taskIds),
      },
    });

    const entriesByTaskId = this.groupTimeEntriesByTask(timeEntries);
    const typeNames = new Map(
      (settings?.taskTypes ?? []).map((type) => [type.id, type.name]),
    );

    const minutesByType = new Map<string, number>();
    for (const task of tasks) {
      const minutes = this.resolveTaskTrackedMinutes(task, entriesByTaskId);
      if (minutes <= 0) continue;

      const label = task.taskTypeId
        ? typeNames.get(task.taskTypeId) ?? 'Outros'
        : 'Sem tipo';

      minutesByType.set(label, (minutesByType.get(label) ?? 0) + minutes);
    }

    return Array.from(minutesByType.entries())
      .map(([taskType, minutes]) => ({
        taskType,
        minutes,
        hours: roundMoney(minutes / 60),
      }))
      .sort((a, b) => b.minutes - a.minutes);
  }

  private async getSettings(ctx: FinanceRequestContext) {
    let settings = await this.settingsRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!settings) {
      settings = await this.settingsRepo.save(
        this.settingsRepo.create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        }),
      );
    }

    return settings;
  }

  private async getRules(ctx: FinanceRequestContext) {
    let rules = await this.rulesRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!rules) {
      rules = await this.rulesRepo.save(
        this.rulesRepo.create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        }),
      );
    }

    return rules;
  }

  private groupTasksByProject(tasks: AgencyTask[]) {
    const grouped = new Map<string, AgencyTask[]>();

    for (const task of tasks) {
      if (!task.projectId) continue;

      const current = grouped.get(task.projectId) ?? [];
      current.push(task);
      grouped.set(task.projectId, current);
    }

    return grouped;
  }

  private calculateTimeByProject(
    tasks: AgencyTask[],
    timeEntries: AgencyTaskTimeEntry[],
  ) {
    const entriesByTaskId = this.groupTimeEntriesByTask(timeEntries);
    const result = new Map<string, number>();

    for (const task of tasks) {
      if (!task.projectId) continue;

      const minutes = this.resolveTaskTrackedMinutes(task, entriesByTaskId);
      result.set(task.projectId, (result.get(task.projectId) ?? 0) + minutes);
    }

    return result;
  }

  private calculateTimeByClient(
    tasks: AgencyTask[],
    timeEntries: AgencyTaskTimeEntry[],
  ) {
    const entriesByTaskId = this.groupTimeEntriesByTask(timeEntries);
    const result = new Map<string, number>();

    for (const task of tasks) {
      if (!task.clientId) continue;

      const minutes = this.resolveTaskTrackedMinutes(task, entriesByTaskId);
      result.set(task.clientId, (result.get(task.clientId) ?? 0) + minutes);
    }

    return result;
  }

  private groupTimeEntriesByTask(timeEntries: AgencyTaskTimeEntry[]) {
    const grouped = new Map<string, AgencyTaskTimeEntry[]>();

    for (const entry of timeEntries) {
      const current = grouped.get(entry.taskId) ?? [];
      current.push(entry);
      grouped.set(entry.taskId, current);
    }

    return grouped;
  }

  private resolveTaskTrackedMinutes(
    task: AgencyTask,
    entriesByTaskId: Map<string, AgencyTaskTimeEntry[]>,
  ) {
    const entries = entriesByTaskId.get(task.id) ?? [];

    if (entries.length > 0) {
      return entries.reduce(
        (sum, entry) => sum + (entry.durationMinutes ?? 0),
        0,
      );
    }

    return task.trackedMinutes ?? 0;
  }

  private sumProjectInvoiceRevenue(
    projectId: string,
    invoices: FinanceInvoice[],
  ) {
    return invoices
      .filter((invoice) => this.isProjectSource(invoice.sourceModule, invoice.sourceId, projectId))
      .reduce((sum, invoice) => sum + toNumber(invoice.totalAmount), 0);
  }

  private sumClientInvoiceRevenue(clientId: string, invoices: FinanceInvoice[]) {
    return invoices
      .filter((invoice) => invoice.customerId === clientId)
      .reduce((sum, invoice) => sum + toNumber(invoice.totalAmount), 0);
  }

  private sumProjectRecurringRevenue(
    projectId: string,
    profiles: FinanceRecurringProfile[],
  ) {
    return profiles
      .filter((profile) => this.isProjectSource(profile.sourceModule, profile.sourceId, projectId))
      .reduce((sum, profile) => sum + this.normalizeRecurringAmount(profile), 0);
  }

  private sumClientRecurringRevenue(
    clientId: string,
    profiles: FinanceRecurringProfile[],
  ) {
    return profiles
      .filter((profile) => profile.customerId === clientId)
      .reduce((sum, profile) => sum + this.normalizeRecurringAmount(profile), 0);
  }

  private sumProjectDirectCosts(projectId: string, bills: FinanceBill[]) {
    return bills
      .filter((bill) => {
        const metadataProjectId = getMetadataString(bill.metadata, [
          'projectId',
          'project_id',
          'agencyProjectId',
        ]);

        return metadataProjectId === projectId;
      })
      .reduce((sum, bill) => sum + toNumber(bill.totalAmount), 0);
  }

  private sumClientDirectCosts(clientId: string, bills: FinanceBill[]) {
    return bills
      .filter((bill) => {
        const metadataClientId = getMetadataString(bill.metadata, [
          'clientId',
          'client_id',
          'customerId',
          'customer_id',
        ]);

        return metadataClientId === clientId;
      })
      .reduce((sum, bill) => sum + toNumber(bill.totalAmount), 0);
  }

  private normalizeRecurringAmount(profile: FinanceRecurringProfile) {
    const amount = toNumber(profile.amount);

    switch (String(profile.interval)) {
      case 'weekly':
        return amount * 4;
      case 'quarterly':
        return amount / 3;
      case 'semiannual':
        return amount / 6;
      case 'yearly':
        return amount / 12;
      case 'monthly':
      default:
        return amount;
    }
  }

  private isProjectSource(
    sourceModule: string | null,
    sourceId: string | null,
    projectId: string,
  ) {
    if (!sourceModule || !sourceId) return false;

    const normalized = sourceModule.toLowerCase();

    return (
      ['project', 'projects', 'agency_project', 'agency_projects'].includes(
        normalized,
      ) && sourceId === projectId
    );
  }

  private buildItem(input: {
    id: string;
    name: string;
    clientId: string | null;
    revenue: number;
    invoicedRevenue: number;
    recurringRevenue: number;
    directCosts: number;
    laborMinutes: number;
    laborCost: number;
    tasks: number;
    rules: FinanceProfitabilityRule;
    metadata?: Record<string, unknown>;
  }): ProfitabilityItem & { metadata?: Record<string, unknown> } {
    const laborHours = input.laborMinutes / 60;
    const grossProfit = input.revenue - input.directCosts - input.laborCost;
    const margin = input.revenue > 0 ? grossProfit / input.revenue : 0;

    return {
      id: input.id,
      name: input.name,
      clientId: input.clientId,
      revenue: roundMoney(input.revenue),
      recurringRevenue: roundMoney(input.recurringRevenue),
      invoicedRevenue: roundMoney(input.invoicedRevenue),
      directCosts: roundMoney(input.directCosts),
      laborMinutes: input.laborMinutes,
      laborHours: roundMoney(laborHours),
      laborCost: roundMoney(input.laborCost),
      grossProfit: roundMoney(grossProfit),
      margin: roundRate(margin),
      health: this.resolveHealth(margin, input.revenue, grossProfit, input.rules),
      tasks: input.tasks,
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
  }

  private calculateTotals(items: ProfitabilityItem[]) {
    const revenue = items.reduce((sum, item) => sum + item.revenue, 0);
    const invoicedRevenue = items.reduce(
      (sum, item) => sum + item.invoicedRevenue,
      0,
    );
    const recurringRevenue = items.reduce(
      (sum, item) => sum + item.recurringRevenue,
      0,
    );
    const directCosts = items.reduce((sum, item) => sum + item.directCosts, 0);
    const laborMinutes = items.reduce((sum, item) => sum + item.laborMinutes, 0);
    const laborHours = laborMinutes / 60;
    const laborCost = items.reduce((sum, item) => sum + item.laborCost, 0);
    const grossProfit = revenue - directCosts - laborCost;
    const margin = revenue > 0 ? grossProfit / revenue : 0;

    return {
      revenue,
      invoicedRevenue,
      recurringRevenue,
      directCosts,
      laborMinutes,
      laborHours,
      laborCost,
      grossProfit,
      margin,
    };
  }

  private resolveHealth(
    margin: number,
    revenue: number,
    grossProfit: number,
    rules: FinanceProfitabilityRule,
  ): ProfitabilityHealth {
    if (revenue <= 0 && grossProfit < 0) return 'loss';
    if (revenue <= 0) return 'no_revenue';
    if (grossProfit < 0) return 'loss';

    if (margin >= toNumber(rules.healthyMarginThreshold)) return 'healthy';
    if (margin >= toNumber(rules.attentionMarginThreshold)) return 'attention';
    if (margin >= toNumber(rules.riskMarginThreshold)) return 'risk';

    return 'loss';
  }
}
