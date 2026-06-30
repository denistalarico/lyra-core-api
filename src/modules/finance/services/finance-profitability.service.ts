import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  AgencyProject,
  AgencyProjectSettings,
  AgencyTask,
  AgencyTaskChecklistItem,
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

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── Month helpers (YYYY-MM) ──────────────────────────────────────────────────
// The monthly profitability series buckets every figure into a YYYY-MM key and
// fills gaps with zero so the chart stays continuous.

const MONTH_RE = /^(\d{4})-(\d{2})/;

// Accepts 'YYYY-MM' or any 'YYYY-MM-...' date string and returns the YYYY-MM
// part, or null when the value is not a recognisable month.
function normalizeMonth(value: string | null | undefined): string | null {
  if (!value) return null;

  const match = MONTH_RE.exec(String(value));
  if (!match) return null;

  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  return `${match[1]}-${match[2]}`;
}

function monthIndex(month: string): number {
  const [year, mon] = month.split('-').map(Number);
  return year * 12 + (mon - 1);
}

function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const mon = (index % 12) + 1;
  return `${year}-${String(mon).padStart(2, '0')}`;
}

function listMonths(start: string, end: string): string[] {
  const months: string[] = [];
  for (let i = monthIndex(start); i <= monthIndex(end); i++) {
    months.push(monthFromIndex(i));
  }
  return months;
}

// YYYY-MM bucket for a date (Date or string). Dates are read in UTC to match the
// rest of the profitability window logic.
function monthOfDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 7);
  }

  return normalizeMonth(value);
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

    @InjectRepository(AgencyTaskChecklistItem, 'agency')
    private readonly checklistItemsRepo: Repository<AgencyTaskChecklistItem>,

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
      checklistItems,
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
      this.checklistItemsRepo.find({
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
      checklistItems,
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

  // ── Monthly profitability series (análise mensal) ───────────────────────────
  //
  // Same canonical sources as the headline KPIs, aggregated per YYYY-MM month
  // instead of the single current-month window:
  //   • revenue     — confirmed/issued invoices by customerId (draft/cancelled/
  //                   void excluded), bucketed by issueDate (createdAt fallback);
  //   • directCost  — payable bill lines whose effective cost center is the
  //                   client cost center (draft/cancelled bills excluded),
  //                   bucketed by competence (metadata, then bill periodStart);
  //   • laborCost   — tracked time (time entries by startedAt, task
  //                   trackedMinutes fallback) × responsible member hourly cost.
  //
  // Months with no movement are emitted with zero so the chart stays continuous.
  // Recurring profiles and contracted fees are NOT projected into the historical
  // series (they are "current snapshot" concepts) — see notes.
  async getClientMonthlyProfitability(
    ctx: FinanceRequestContext,
    clientId: string,
    options: { startMonth?: string; endMonth?: string; months?: number } = {},
  ) {
    const [settings, rules] = await Promise.all([
      this.getSettings(ctx),
      this.getRules(ctx),
    ]);
    const defaultHourlyCost = toNumber(rules.defaultHourlyCost);

    const range = this.resolveMonthRange(options);
    const monthsInRange = new Set(range.months);

    const [invoices, bills, billLines, costCenters, members, clientProjects] =
      await Promise.all([
        this.invoicesRepo.find({
          where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
        }),
        this.billsRepo.find({
          where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
        }),
        this.billLinesRepo.find({
          where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
        }),
        this.costCentersRepo.find({
          where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
        }),
        this.teamMembersRepo.find({
          where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
        }),
        this.projectsRepo.find({
          where: {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            clientId,
          },
        }),
      ]);

    const projectIds = clientProjects.map((project) => project.id);
    const projectClientById = new Map<string, string | null>(
      clientProjects.map((project) => [project.id, project.clientId ?? null]),
    );

    // Tasks owned by the client directly OR belonging to one of its projects.
    const tasks = await this.tasksRepo.find({
      where: [
        { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId, clientId },
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
    const relevantTasks = tasks.filter(
      (task) => this.resolveTaskClientId(task, projectClientById) === clientId,
    );
    const taskIds = relevantTasks.map((task) => task.id);

    const timeEntries = taskIds.length
      ? await this.timeEntriesRepo.find({
          where: {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            taskId: In(taskIds),
          },
        })
      : [];
    const checklistItems = taskIds.length
      ? await this.checklistItemsRepo.find({
          where: {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            taskId: In(taskIds),
          },
        })
      : [];

    const revenueByMonth = this.aggregateClientRevenueByMonth(
      invoices,
      clientId,
      monthsInRange,
    );
    const directCostByMonth = this.aggregateClientDirectCostByMonth(
      bills,
      billLines,
      costCenters,
      clientId,
      monthsInRange,
    );
    const laborByMonth = this.aggregateClientLaborByMonth(
      relevantTasks,
      checklistItems,
      timeEntries,
      members,
      defaultHourlyCost,
      monthsInRange,
    );

    let totalHoursWithoutCost = 0;
    const allMembersMissing = new Set<string>();

    const series = range.months.map((month) => {
      const revenue = roundMoney(revenueByMonth.get(month) ?? 0);
      const directCost = roundMoney(directCostByMonth.get(month) ?? 0);
      const labor = laborByMonth.get(month);
      const laborCost = roundMoney(labor?.cost ?? 0);
      const directProfit = roundMoney(revenue - directCost - laborCost);
      // Margin is 0 (not 100%) when there is no revenue, even if costs exist —
      // the negative result is still visible in directProfit.
      const directMargin =
        revenue > 0 ? roundPercent((directProfit / revenue) * 100) : 0;
      const minutes = labor?.minutes ?? 0;
      const hoursWithoutCost = roundMoney((labor?.minutesWithoutCost ?? 0) / 60);
      const membersMissingCost = labor
        ? Array.from(labor.membersMissingCost)
        : [];

      totalHoursWithoutCost += labor?.minutesWithoutCost ?? 0;
      membersMissingCost.forEach((name) => allMembersMissing.add(name));

      return {
        month,
        revenue,
        directCost,
        laborCost,
        directProfit,
        directMargin,
        hoursLogged: roundMoney(minutes / 60),
        entriesWithoutCostCount: labor?.entriesWithoutCost ?? 0,
        hoursWithoutCost,
        membersMissingCost,
      };
    });

    const sum = (pick: (point: (typeof series)[number]) => number) =>
      roundMoney(series.reduce((total, point) => total + pick(point), 0));

    return {
      status: 'ok' as const,
      module: 'agency-finance',
      area: 'profitability',
      type: 'client_monthly',
      id: clientId,
      currency: settings.baseCurrency,
      period: {
        type: 'monthly_series',
        start: range.start,
        end: range.end,
        months: range.months.length,
      },
      series,
      summary: {
        revenue: sum((point) => point.revenue),
        directCost: sum((point) => point.directCost),
        laborCost: sum((point) => point.laborCost),
        directProfit: sum((point) => point.directProfit),
        hoursLogged: sum((point) => point.hoursLogged),
        hoursWithoutCost: roundMoney(totalHoursWithoutCost / 60),
        membersMissingCost: Array.from(allMembersMissing),
      },
      notes: [
        'Monthly revenue: confirmed/issued invoices by customerId (draft/cancelled/void excluded), bucketed by issueDate (createdAt fallback). Recurring profiles and contracted monthly fees are NOT projected into the historical series.',
        'Monthly direct cost: payable (bill) lines whose effective cost center is the client cost center (draft/cancelled bills excluded), bucketed by competence (metadata competencePeriod/accrualDate, then bill periodStart/issueDate/createdAt).',
        'Monthly labor cost: tracked time (time entries by startedAt, task trackedMinutes fallback by completedAt/updatedAt) × responsible member hourly cost; hours without a configured cost are reported in hoursWithoutCost/membersMissingCost.',
        'This is a DIRECT margin: shared/overhead costs are NOT allocated to the client in this view.',
      ],
    };
  }

  // Resolves the requested window into an inclusive ascending list of YYYY-MM
  // months. Defaults to the trailing 12 months ending in the current month; a
  // 36-month span cap protects against unbounded ranges.
  private resolveMonthRange(options: {
    startMonth?: string;
    endMonth?: string;
    months?: number;
  }): { months: string[]; start: string; end: string } {
    const MAX_MONTHS = 36;
    const currentMonth = new Date().toISOString().slice(0, 7);

    const end = normalizeMonth(options.endMonth) ?? currentMonth;
    const startInput = normalizeMonth(options.startMonth);

    let start: string;
    if (startInput) {
      start = startInput;
    } else {
      const requested = Math.trunc(Number(options.months));
      const count = Math.min(
        Math.max(Number.isFinite(requested) && requested > 0 ? requested : 12, 1),
        MAX_MONTHS,
      );
      start = monthFromIndex(monthIndex(end) - (count - 1));
    }

    let from = monthIndex(start);
    let to = monthIndex(end);
    if (from > to) [from, to] = [to, from];
    if (to - from + 1 > MAX_MONTHS) from = to - (MAX_MONTHS - 1);

    const startMonth = monthFromIndex(from);
    const endMonth = monthFromIndex(to);

    return {
      months: listMonths(startMonth, endMonth),
      start: startMonth,
      end: endMonth,
    };
  }

  private aggregateClientRevenueByMonth(
    invoices: FinanceInvoice[],
    clientId: string,
    monthsInRange: Set<string>,
  ): Map<string, number> {
    const byMonth = new Map<string, number>();

    for (const invoice of invoices) {
      if (invoice.customerId !== clientId) continue;
      if (['cancelled', 'void', 'draft'].includes(String(invoice.status))) {
        continue;
      }

      const month =
        monthOfDate(invoice.issueDate) ?? monthOfDate(invoice.createdAt);
      if (!month || !monthsInRange.has(month)) continue;

      byMonth.set(month, (byMonth.get(month) ?? 0) + toNumber(invoice.totalAmount));
    }

    return byMonth;
  }

  private aggregateClientDirectCostByMonth(
    bills: FinanceBill[],
    billLines: FinanceBillLine[],
    costCenters: FinanceCostCenter[],
    clientId: string,
    monthsInRange: Set<string>,
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

    const byMonth = new Map<string, number>();

    for (const bill of bills) {
      const status = String(bill.status);
      if (status === 'cancelled' || status === 'draft') continue;

      const month = this.resolveBillCompetenceMonth(bill);
      if (!month || !monthsInRange.has(month)) continue;

      const lines = linesByBillId.get(bill.id) ?? [];
      for (const line of lines) {
        const amount = toNumber(line.totalAmount);
        if (amount === 0) continue;

        const effectiveCostCenter =
          line.costCenterId ?? bill.costCenterId ?? null;
        let lineClientId = effectiveCostCenter
          ? clientIdByCostCenterId.get(effectiveCostCenter) ?? null
          : null;

        if (!lineClientId) {
          lineClientId =
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

        if (lineClientId !== clientId) continue;
        byMonth.set(month, (byMonth.get(month) ?? 0) + amount);
      }
    }

    return byMonth;
  }

  // Competence month for a bill: metadata competence first, then the bill's own
  // accrual/issue/creation dates as fallback.
  private resolveBillCompetenceMonth(bill: FinanceBill): string | null {
    const metadataMonth =
      normalizeMonth(
        getMetadataString(bill.metadata, [
          'competencePeriod',
          'competence',
          'competenceMonth',
        ]),
      ) ??
      monthOfDate(
        getMetadataString(bill.metadata, ['accrualDate', 'competenceDate']),
      );
    if (metadataMonth) return metadataMonth;

    return (
      monthOfDate(bill.periodStart) ??
      monthOfDate(bill.issueDate) ??
      monthOfDate(bill.createdAt)
    );
  }

  private aggregateClientLaborByMonth(
    tasks: AgencyTask[],
    checklistItems: AgencyTaskChecklistItem[],
    timeEntries: AgencyTaskTimeEntry[],
    members: TeamMember[],
    defaultHourlyCost: number,
    monthsInRange: Set<string>,
  ): Map<
    string,
    {
      minutes: number;
      cost: number;
      minutesWithoutCost: number;
      entriesWithoutCost: number;
      membersMissingCost: Set<string>;
    }
  > {
    type MonthLabor = {
      minutes: number;
      cost: number;
      minutesWithoutCost: number;
      entriesWithoutCost: number;
      membersMissingCost: Set<string>;
    };

    const memberByUserId = new Map<string, TeamMember>();
    const memberById = new Map<string, TeamMember>();
    for (const member of members) {
      memberById.set(member.id, member);
      if (member.userId) memberByUserId.set(member.userId, member);
    }

    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const checklistItemById = new Map(
      checklistItems.map((item) => [item.id, item]),
    );
    const byMonth = new Map<string, MonthLabor>();
    const tasksWithEntries = new Set<string>();

    const ensure = (month: string): MonthLabor => {
      let bucket = byMonth.get(month);
      if (!bucket) {
        bucket = {
          minutes: 0,
          cost: 0,
          minutesWithoutCost: 0,
          entriesWithoutCost: 0,
          membersMissingCost: new Set<string>(),
        };
        byMonth.set(month, bucket);
      }
      return bucket;
    };

    const addLabor = (
      month: string | null,
      minutes: number,
      member: TeamMember | null,
    ) => {
      if (!month || !monthsInRange.has(month) || minutes <= 0) return;

      const memberRate = this.resolveMemberHourlyCost(member);
      const rate = memberRate > 0 ? memberRate : defaultHourlyCost;
      const bucket = ensure(month);
      bucket.minutes += minutes;
      bucket.cost += (minutes / 60) * rate;
      if (rate <= 0) {
        bucket.minutesWithoutCost += minutes;
        bucket.entriesWithoutCost += 1;
        bucket.membersMissingCost.add(
          member?.displayName ?? 'Responsável sem custo definido',
        );
      }
    };

    for (const entry of timeEntries) {
      const task = taskById.get(entry.taskId);
      if (!task) continue;
      tasksWithEntries.add(task.id);
      const minutes = entry.durationMinutes ?? 0;
      if (minutes <= 0) continue;
      const checklistItem = entry.checklistItemId
        ? checklistItemById.get(entry.checklistItemId) ?? null
        : null;
      const member = checklistItem?.assigneeId
        ? memberById.get(checklistItem.assigneeId) ?? null
        : entry.userId
          ? memberByUserId.get(entry.userId) ?? null
          : null;
      addLabor(monthOfDate(entry.startedAt), minutes, member);
    }

    for (const task of tasks) {
      if (tasksWithEntries.has(task.id)) continue;
      const minutes = task.trackedMinutes ?? 0;
      if (minutes <= 0) continue;
      const member = task.assigneeId
        ? memberById.get(task.assigneeId) ?? null
        : null;
      const month =
        monthOfDate(task.completedAt) ??
        monthOfDate(task.updatedAt) ??
        monthOfDate(task.createdAt);
      addLabor(month, minutes, member);
    }

    return byMonth;
  }

  // Hours spent on a client's tasks grouped by task/subtask type (the "horas
  // por tipo de tarefa" breakdown). Time entries tagged with a checklist item
  // use that subtask's taskTypeId; plain task entries and trackedMinutes
  // fallback use the parent task's type.
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
    const checklistItems = await this.checklistItemsRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        taskId: In(taskIds),
      },
    });

    const entriesByTaskId = this.groupTimeEntriesByTask(timeEntries);
    const checklistItemById = new Map(
      checklistItems.map((item) => [item.id, item]),
    );
    const typeNames = new Map(
      (settings?.taskTypes ?? []).map((type) => [type.id, type.name]),
    );

    const minutesByType = new Map<string, number>();
    for (const task of relevantTasks) {
      const entries = entriesByTaskId.get(task.id) ?? [];
      if (entries.length > 0) {
        for (const entry of entries) {
          const minutes = entry.durationMinutes ?? 0;
          if (minutes <= 0) continue;
          const checklistItem = entry.checklistItemId
            ? checklistItemById.get(entry.checklistItemId) ?? null
            : null;
          const typeId = checklistItem?.taskTypeId ?? task.taskTypeId;
          const label = typeId
            ? typeNames.get(typeId) ?? 'Outros'
            : 'Sem tipo';

          minutesByType.set(label, (minutesByType.get(label) ?? 0) + minutes);
        }
        continue;
      }

      const minutes = task.trackedMinutes ?? 0;
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
  //   • subtask time entries are priced by the checklist item's assignee;
  //   • plain task time entries are priced by the user who logged them;
  //   • tasks without entries fall back to trackedMinutes priced by the task
  //     assignee (assigneeId is a team_member id).
  // When no member cost is available, the workspace default rate is used; if that
  // is also 0 the time is flagged in minutesWithoutCost / membersMissingCost so
  // the UI can warn that hourly costs are not fully configured.
  private calculateLabor(
    tasks: AgencyTask[],
    checklistItems: AgencyTaskChecklistItem[],
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
    const checklistItemById = new Map(
      checklistItems.map((item) => [item.id, item]),
    );
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
      const checklistItem = entry.checklistItemId
        ? checklistItemById.get(entry.checklistItemId) ?? null
        : null;
      const member = checklistItem?.assigneeId
        ? memberById.get(checklistItem.assigneeId) ?? null
        : entry.userId
          ? memberByUserId.get(entry.userId) ?? null
          : null;
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
