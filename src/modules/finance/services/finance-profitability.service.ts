import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AgencyProject,
  AgencyProjectSettings,
  AgencyTask,
  AgencyTaskTimeEntry,
} from '../../projects/entities';
import { TeamMember } from '../../team/entities';
import {
  FinanceBill,
  FinanceBillLine,
  FinanceCostCenter,
  FinanceInvoice,
  FinanceProfitabilityRule,
  FinanceRecurringProfile,
  FinanceSetting,
} from '../entities';
import { FinanceRequestContext } from './finance-context';

// Average paid hours per month used to derive an hourly rate from a member's
// monthly cost when neither an explicit hourly cost nor a contracted-hours value
// is configured (≈ 40h/week × 52 weeks / 12 months).
const DEFAULT_MONTHLY_HOURS = 173.33;

type LaborAggregate = {
  minutes: number;
  cost: number;
  minutesWithoutCost: number;
  membersMissingCost: Set<string>;
};

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
  // Configuration completeness signals for labor cost: how much tracked time
  // had no hourly cost available, and which responsibles are missing a cost.
  hoursWithoutCost: number;
  membersMissingCost: string[];
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

    @InjectRepository(FinanceBillLine, 'agency')
    private readonly billLinesRepo: Repository<FinanceBillLine>,

    @InjectRepository(FinanceCostCenter, 'agency')
    private readonly costCentersRepo: Repository<FinanceCostCenter>,

    @InjectRepository(TeamMember, 'agency')
    private readonly teamMembersRepo: Repository<TeamMember>,

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
      billLines,
      costCenters,
      teamMembers,
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
      this.billLinesRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      }),
      this.costCentersRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      }),
      this.teamMembersRepo.find({
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
    // A task inherits its client from its project when it has no client of its
    // own — tasks created inside a client's project only carry projectId.
    const projectClientById = new Map<string, string | null>(
      projects.map((project) => [project.id, project.clientId ?? null]),
    );

    // Labor cost = tracked time × the responsible member's hourly cost (with a
    // monthlyCost/contracted-hours and a workspace-default fallback). Computed
    // once and bucketed per project and per client.
    const labor = this.calculateLabor(
      tasks,
      timeEntries,
      teamMembers,
      projectClientById,
      defaultHourlyCost,
    );

    const validInvoices = invoices.filter(
      (invoice) =>
        !['cancelled', 'void', 'draft'].includes(String(invoice.status)),
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

    // Direct cost (per client) = confirmed payable lines whose effective cost
    // center is the client's own cost center. Draft bills are not recognised yet
    // so they never count as a realised direct cost.
    const periodCostBills = periodBills.filter(
      (bill) => String(bill.status) !== 'draft',
    );
    const directCostByClientId = this.calculateDirectCostByClient(
      periodCostBills,
      billLines,
      costCenters,
    );

    const activeRecurringProfiles = recurringProfiles.filter(
      (profile) => String(profile.status) === 'active',
    );

    const projectsProfitability = projects.map((project) => {
      const projectTasks = tasksByProjectId.get(project.id) ?? [];
      const projectLabor = labor.byProject.get(project.id);

      const invoicedRevenue = this.sumProjectInvoiceRevenue(
        project.id,
        periodInvoices,
      );

      const recurringRevenue = this.sumProjectRecurringRevenue(
        project.id,
        activeRecurringProfiles,
      );

      const directCosts = this.sumProjectDirectCosts(project.id, periodCostBills);

      return this.buildItem({
        id: project.id,
        name: project.name,
        clientId: project.clientId ?? null,
        revenue: invoicedRevenue + recurringRevenue,
        invoicedRevenue,
        recurringRevenue,
        directCosts,
        laborMinutes: projectLabor?.minutes ?? 0,
        laborCost: projectLabor?.cost ?? 0,
        labor: projectLabor,
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

      const clientTasks = tasks.filter(
        (task) =>
          this.resolveTaskClientId(task, projectClientById) === clientId,
      );

      const clientLabor = labor.byClient.get(clientId);

      const invoicedRevenue = this.sumClientInvoiceRevenue(
        clientId,
        periodInvoices,
      );

      const recurringRevenue = this.sumClientRecurringRevenue(
        clientId,
        activeRecurringProfiles,
      );

      const directCosts = directCostByClientId.get(clientId) ?? 0;

      return this.buildItem({
        id: clientId,
        name: `Cliente ${clientId.slice(0, 8)}`,
        clientId,
        revenue: invoicedRevenue + recurringRevenue,
        invoicedRevenue,
        recurringRevenue,
        directCosts,
        laborMinutes: clientLabor?.minutes ?? 0,
        laborCost: clientLabor?.cost ?? 0,
        labor: clientLabor,
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
        'Revenue source: confirmed/issued invoices (draft and cancelled excluded) linked by customerId, plus active recurring profiles.',
        'Direct cost source: confirmed payable (bill) lines whose effective cost center is the client cost center (draft/cancelled bills excluded). Falls back to bill/line metadata clientId when no cost center matches.',
        'Labor cost: tracked time (time entries first, task trackedMinutes fallback) × responsible member hourly cost — fallback monthlyCost/contracted-hours, then workspace default; unconfigured costs are reported in membersMissingCost/hoursWithoutCost.',
        'This is a DIRECT margin: shared/overhead costs (tools, infrastructure, internal cost centers) are NOT allocated to clients in this view.',
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
    const [clientProjects, settings] = await Promise.all([
      this.projectsRepo.find({
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

    const projectIds = clientProjects.map((project) => project.id);

    // Tasks owned by the client directly OR belonging to one of its projects
    // (tasks created inside a client's project only carry projectId).
    const tasks = await this.tasksRepo.find({
      where: [
        {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          clientId,
        },
        ...(projectIds.length
          ? [
              {
                tenantId: ctx.tenantId,
                workspaceId: ctx.workspaceId,
                projectId: In(projectIds),
              },
            ]
          : []),
      ],
    });

    if (tasks.length === 0) return [];

    // Exclude tasks that were matched via projectId but explicitly tagged to a
    // different client, so the breakdown matches the labor-hours total.
    const relevantTasks = tasks.filter(
      (task) => !task.clientId || task.clientId === clientId,
    );

    if (relevantTasks.length === 0) return [];

    const taskIds = relevantTasks.map((task) => task.id);
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
    for (const task of relevantTasks) {
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

  // ── Labor cost (mão de obra) ────────────────────────────────────────────
  //
  // Buckets tracked time and its cost per project and per client. Each minute is
  // priced with the responsible member's hourly cost:
  //   • time entries are priced by the user who logged them (entry.userId);
  //   • tasks without entries fall back to trackedMinutes priced by the task
  //     assignee (assigneeId is a team_member id).
  // When no member cost is available, the workspace default rate is used; if that
  // is also 0 the time is flagged in minutesWithoutCost / membersMissingCost so
  // the UI can warn that hourly costs are not fully configured.
  private calculateLabor(
    tasks: AgencyTask[],
    timeEntries: AgencyTaskTimeEntry[],
    members: TeamMember[],
    projectClientById: Map<string, string | null>,
    defaultHourlyCost: number,
  ): { byProject: Map<string, LaborAggregate>; byClient: Map<string, LaborAggregate> } {
    const memberByUserId = new Map<string, TeamMember>();
    const memberById = new Map<string, TeamMember>();
    for (const member of members) {
      memberById.set(member.id, member);
      if (member.userId) memberByUserId.set(member.userId, member);
    }

    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const byProject = new Map<string, LaborAggregate>();
    const byClient = new Map<string, LaborAggregate>();
    const tasksWithEntries = new Set<string>();

    const accumulate = (
      map: Map<string, LaborAggregate>,
      key: string | null,
      minutes: number,
      rate: number,
      label: string,
    ) => {
      if (!key || minutes <= 0) return;
      const agg = map.get(key) ?? {
        minutes: 0,
        cost: 0,
        minutesWithoutCost: 0,
        membersMissingCost: new Set<string>(),
      };
      agg.minutes += minutes;
      agg.cost += (minutes / 60) * rate;
      if (rate <= 0) {
        agg.minutesWithoutCost += minutes;
        agg.membersMissingCost.add(label);
      }
      map.set(key, agg);
    };

    const apply = (
      task: AgencyTask,
      minutes: number,
      member: TeamMember | null,
    ) => {
      if (minutes <= 0) return;
      const memberRate = this.resolveMemberHourlyCost(member);
      const rate = memberRate > 0 ? memberRate : defaultHourlyCost;
      const label = member?.displayName ?? 'Responsável sem custo definido';
      const clientId = this.resolveTaskClientId(task, projectClientById);
      accumulate(byClient, clientId, minutes, rate, label);
      accumulate(byProject, task.projectId, minutes, rate, label);
    };

    for (const entry of timeEntries) {
      const task = taskById.get(entry.taskId);
      if (!task) continue;
      tasksWithEntries.add(task.id);
      const minutes = entry.durationMinutes ?? 0;
      if (minutes <= 0) continue;
      const member = entry.userId ? memberByUserId.get(entry.userId) ?? null : null;
      apply(task, minutes, member);
    }

    for (const task of tasks) {
      if (tasksWithEntries.has(task.id)) continue;
      const minutes = task.trackedMinutes ?? 0;
      if (minutes <= 0) continue;
      const member = task.assigneeId
        ? memberById.get(task.assigneeId) ?? null
        : null;
      apply(task, minutes, member);
    }

    return { byProject, byClient };
  }

  // Hourly cost for a member following the configured fallback chain:
  //   1. explicit hourlyCost; 2. monthlyCost / contracted-hours; else 0.
  private resolveMemberHourlyCost(member: TeamMember | null | undefined): number {
    if (!member) return 0;

    const hourly = toNumber(member.hourlyCost);
    if (hourly > 0) return hourly;

    const monthly = toNumber(member.monthlyCost);
    if (monthly > 0) {
      const hours = this.resolveMonthlyContractedHours(member);
      if (hours > 0) return monthly / hours;
    }

    return 0;
  }

  private resolveMonthlyContractedHours(member: TeamMember): number {
    const metadata = member.metadata as Record<string, unknown> | undefined;
    const monthly = toNumber(
      (metadata?.contractedHours as number) ??
        (metadata?.contractedMonthlyHours as number) ??
        (metadata?.monthlyHours as number),
    );
    if (monthly > 0) return monthly;

    const weekly = toNumber(
      (metadata?.weeklyHours as number) ??
        (metadata?.contractedWeeklyHours as number),
    );
    if (weekly > 0) return weekly * 4.333;

    return DEFAULT_MONTHLY_HOURS;
  }

  // ── Direct cost (custo direto) ──────────────────────────────────────────
  //
  // Sums payable lines per client using the client's own cost center as the
  // canonical link (effective cost center = line.costCenterId ?? bill.costCenterId).
  // When a line resolves to no client cost center it falls back to a clientId
  // stored in line/bill metadata, so each line is attributed at most once.
  private calculateDirectCostByClient(
    bills: FinanceBill[],
    billLines: FinanceBillLine[],
    costCenters: FinanceCostCenter[],
  ): Map<string, number> {
    const clientIdByCostCenterId = new Map<string, string>();
    for (const cc of costCenters) {
      if (cc.relatedEntityType === 'client' && cc.relatedEntityId) {
        clientIdByCostCenterId.set(cc.id, cc.relatedEntityId);
      }
    }

    const linesByBillId = new Map<string, FinanceBillLine[]>();
    for (const line of billLines) {
      const current = linesByBillId.get(line.billId) ?? [];
      current.push(line);
      linesByBillId.set(line.billId, current);
    }

    const result = new Map<string, number>();
    for (const bill of bills) {
      const lines = linesByBillId.get(bill.id) ?? [];
      for (const line of lines) {
        const amount = toNumber(line.totalAmount);
        if (amount === 0) continue;

        const effectiveCostCenter = line.costCenterId ?? bill.costCenterId ?? null;
        let clientId = effectiveCostCenter
          ? clientIdByCostCenterId.get(effectiveCostCenter) ?? null
          : null;

        if (!clientId) {
          clientId =
            getMetadataString(line.metadata, [
              'clientId',
              'client_id',
              'customerId',
              'customer_id',
            ]) ??
            getMetadataString(bill.metadata, [
              'clientId',
              'client_id',
              'customerId',
              'customer_id',
            ]);
        }

        if (!clientId) continue;
        result.set(clientId, (result.get(clientId) ?? 0) + amount);
      }
    }

    return result;
  }

  // Effective client of a task: its own clientId when set, otherwise the client
  // of the project it belongs to.
  private resolveTaskClientId(
    task: AgencyTask,
    projectClientById: Map<string, string | null>,
  ): string | null {
    if (task.clientId) return task.clientId;
    if (task.projectId) return projectClientById.get(task.projectId) ?? null;
    return null;
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
    labor?: LaborAggregate;
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
      hoursWithoutCost: roundMoney((input.labor?.minutesWithoutCost ?? 0) / 60),
      membersMissingCost: input.labor
        ? Array.from(input.labor.membersMissingCost)
        : [],
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
