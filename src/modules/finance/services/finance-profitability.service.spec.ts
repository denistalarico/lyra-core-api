import { ObjectLiteral, Repository } from 'typeorm';
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
import { FinanceProfitabilityService } from './finance-profitability.service';

const TENANT = 'tenant-1';
const WORKSPACE = 'workspace-1';
const CLIENT = 'client-1';

// A date guaranteed to fall inside the current monthly profitability window.
function inPeriodDate(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15))
    .toISOString()
    .slice(0, 10);
}

function ctx() {
  return { tenantId: TENANT, workspaceId: WORKSPACE, userId: 'user-actor' };
}

type Data = {
  rules?: Partial<FinanceProfitabilityRule>;
  projects?: Partial<AgencyProject>[];
  tasks?: Partial<AgencyTask>[];
  checklistItems?: Partial<AgencyTaskChecklistItem>[];
  timeEntries?: Partial<AgencyTaskTimeEntry>[];
  invoices?: Partial<FinanceInvoice>[];
  bills?: Partial<FinanceBill>[];
  billLines?: Partial<FinanceBillLine>[];
  costCenters?: Partial<FinanceCostCenter>[];
  members?: Partial<TeamMember>[];
  recurringProfiles?: Partial<FinanceRecurringProfile>[];
  projectSettings?: Partial<AgencyProjectSettings>[];
};

function makeService(data: Data) {
  const repo = <T extends ObjectLiteral>(rows: Partial<T>[] = []) =>
    ({
      find: jest.fn().mockResolvedValue(rows),
      findOne: jest.fn().mockResolvedValue(rows[0] ?? null),
      save: jest.fn(async (item: unknown) => item),
      create: jest.fn((value: unknown) => value),
    }) as unknown as Repository<T>;

  const settingsRepo = {
    findOne: jest.fn().mockResolvedValue({ baseCurrency: 'BRL' }),
    create: jest.fn((v: unknown) => v),
    save: jest.fn(async (v: unknown) => v),
  } as unknown as Repository<FinanceSetting>;

  const rulesRepo = {
    findOne: jest.fn().mockResolvedValue({
      defaultHourlyCost: '0',
      healthyMarginThreshold: '0.4',
      attentionMarginThreshold: '0.2',
      riskMarginThreshold: '0',
      overheadAllocationMethod: 'revenue_share',
      includeFixedCostsInClientMargin: true,
      includeTeamTimeCosts: true,
      ...data.rules,
    }),
    create: jest.fn((v: unknown) => v),
    save: jest.fn(async (v: unknown) => v),
  } as unknown as Repository<FinanceProfitabilityRule>;

  const service = new FinanceProfitabilityService(
    settingsRepo,
    rulesRepo,
    repo<FinanceInvoice>(data.invoices),
    repo<FinanceBill>(data.bills),
    repo<FinanceBillLine>(data.billLines),
    repo<FinanceCostCenter>(data.costCenters),
    repo<TeamMember>(data.members),
    repo<FinanceRecurringProfile>(data.recurringProfiles),
    repo<AgencyProject>(data.projects),
    repo<AgencyTask>(data.tasks),
    repo<AgencyTaskChecklistItem>(data.checklistItems),
    repo<AgencyTaskTimeEntry>(data.timeEntries),
    repo<AgencyProjectSettings>(data.projectSettings),
  );

  return service;
}

// A baseline workspace: one client with a linked cost center, one project, one
// task with 2h logged by a member that costs R$ 50/h, R$ 1000 confirmed revenue
// and a R$ 300 confirmed bill line on the client's cost center.
function baseData(overrides: Partial<Data> = {}): Data {
  const date = inPeriodDate();
  return {
    costCenters: [
      { id: 'cc-client', relatedEntityType: 'client', relatedEntityId: CLIENT },
    ],
    projects: [{ id: 'proj-1', name: 'Projeto X', clientId: CLIENT }],
    tasks: [
      {
        id: 'task-1',
        projectId: 'proj-1',
        clientId: null,
        assigneeId: 'member-1',
        trackedMinutes: 0,
        taskTypeId: null,
      } as Partial<AgencyTask>,
    ],
    timeEntries: [
      { taskId: 'task-1', userId: 'user-1', durationMinutes: 120 } as Partial<AgencyTaskTimeEntry>,
    ],
    members: [
      {
        id: 'member-1',
        userId: 'user-1',
        displayName: 'Ana Dev',
        hourlyCost: '50.00',
        monthlyCost: null,
        metadata: {},
      } as Partial<TeamMember>,
    ],
    invoices: [
      {
        id: 'inv-1',
        customerId: CLIENT,
        status: 'issued' as FinanceInvoice['status'],
        totalAmount: '1000.00',
        issueDate: date,
        createdAt: new Date(),
      } as Partial<FinanceInvoice>,
    ],
    bills: [
      {
        id: 'bill-1',
        status: 'open' as FinanceBill['status'],
        costCenterId: 'cc-client',
        issueDate: date,
        createdAt: new Date(),
        metadata: {},
      } as Partial<FinanceBill>,
    ],
    billLines: [
      { id: 'bl-1', billId: 'bill-1', totalAmount: '300.00', costCenterId: null, metadata: {} } as Partial<FinanceBillLine>,
    ],
    ...overrides,
  };
}

async function clientItem(data: Data) {
  const service = makeService(data);
  const overview = await service.getOverview(ctx());
  return overview.clients.find((c) => c.id === CLIENT);
}

describe('FinanceProfitabilityService — direct profitability', () => {
  it('computes labor cost as logged hours × the responsible member hourly cost', async () => {
    const client = await clientItem(baseData());
    expect(client?.laborHours).toBe(2);
    expect(client?.laborCost).toBe(100); // 2h × R$ 50
    expect(client?.hoursWithoutCost).toBe(0);
    expect(client?.membersMissingCost).toEqual([]);
  });

  it('computes direct cost from bill lines on the client cost center', async () => {
    const client = await clientItem(baseData());
    expect(client?.directCosts).toBe(300);
  });

  it('computes revenue, profit and a non-100% margin when there are costs', async () => {
    const client = await clientItem(baseData());
    expect(client?.revenue).toBe(1000);
    expect(client?.grossProfit).toBe(600); // 1000 - 300 - 100
    expect(client?.margin).toBe(0.6);
    expect(client?.margin).not.toBe(1);
  });

  it('falls back to monthlyCost / contracted hours when no hourly cost is set', async () => {
    const data = baseData();
    data.members = [
      {
        id: 'member-1',
        userId: 'user-1',
        displayName: 'Ana Dev',
        hourlyCost: null,
        monthlyCost: '8000.00',
        metadata: { contractedHours: 160 },
      } as Partial<TeamMember>,
    ];
    const client = await clientItem(data);
    // 8000 / 160 = R$ 50/h → 2h = R$ 100
    expect(client?.laborCost).toBe(100);
    expect(client?.hoursWithoutCost).toBe(0);
  });

  it('flags hours without cost when neither member nor workspace rate is set', async () => {
    const data = baseData();
    data.members = [
      {
        id: 'member-1',
        userId: 'user-1',
        displayName: 'Ana Dev',
        hourlyCost: null,
        monthlyCost: null,
        metadata: {},
      } as Partial<TeamMember>,
    ];
    const client = await clientItem(data);
    expect(client?.laborCost).toBe(0);
    expect(client?.hoursWithoutCost).toBe(2);
    expect(client?.membersMissingCost).toContain('Ana Dev');
  });

  it('uses the workspace default hourly cost when the member has none', async () => {
    const data = baseData({ rules: { defaultHourlyCost: '30' } });
    data.members = [
      {
        id: 'member-1',
        userId: 'user-1',
        displayName: 'Ana Dev',
        hourlyCost: null,
        monthlyCost: null,
        metadata: {},
      } as Partial<TeamMember>,
    ];
    const client = await clientItem(data);
    expect(client?.laborCost).toBe(60); // 2h × R$ 30 default
    expect(client?.hoursWithoutCost).toBe(0);
  });

  it('excludes draft invoices from revenue', async () => {
    const data = baseData();
    data.invoices = [
      ...(data.invoices ?? []),
      {
        id: 'inv-draft',
        customerId: CLIENT,
        status: 'draft' as FinanceInvoice['status'],
        totalAmount: '5000.00',
        issueDate: inPeriodDate(),
        createdAt: new Date(),
      } as Partial<FinanceInvoice>,
    ];
    const client = await clientItem(data);
    expect(client?.revenue).toBe(1000); // draft 5000 ignored
  });

  it('excludes cancelled bills from direct cost', async () => {
    const data = baseData();
    data.bills = [
      ...(data.bills ?? []),
      {
        id: 'bill-cancelled',
        status: 'cancelled' as FinanceBill['status'],
        costCenterId: 'cc-client',
        issueDate: inPeriodDate(),
        createdAt: new Date(),
        metadata: {},
      } as Partial<FinanceBill>,
    ];
    data.billLines = [
      ...(data.billLines ?? []),
      { id: 'bl-cancelled', billId: 'bill-cancelled', totalAmount: '999.00', costCenterId: null, metadata: {} } as Partial<FinanceBillLine>,
    ];
    const client = await clientItem(data);
    expect(client?.directCosts).toBe(300); // cancelled 999 ignored
  });

  it('excludes draft bills from direct cost (only confirmed payables count)', async () => {
    const data = baseData();
    data.bills = [
      ...(data.bills ?? []),
      {
        id: 'bill-draft',
        status: 'draft' as FinanceBill['status'],
        costCenterId: 'cc-client',
        issueDate: inPeriodDate(),
        createdAt: new Date(),
        metadata: {},
      } as Partial<FinanceBill>,
    ];
    data.billLines = [
      ...(data.billLines ?? []),
      { id: 'bl-draft', billId: 'bill-draft', totalAmount: '888.00', costCenterId: null, metadata: {} } as Partial<FinanceBillLine>,
    ];
    const client = await clientItem(data);
    expect(client?.directCosts).toBe(300);
  });

  it('attributes labor from a project that belongs to the client (task without own clientId)', async () => {
    // baseData's task has clientId null and inherits the client from its project.
    const client = await clientItem(baseData());
    expect(client?.laborHours).toBe(2);
    expect(client?.laborCost).toBe(100);
  });

  it('attributes labor from a task linked directly to the client', async () => {
    const data = baseData();
    data.projects = [];
    data.tasks = [
      {
        id: 'task-direct',
        projectId: null,
        clientId: CLIENT,
        assigneeId: 'member-1',
        trackedMinutes: 0,
        taskTypeId: null,
      } as Partial<AgencyTask>,
    ];
    data.timeEntries = [
      { taskId: 'task-direct', userId: 'user-1', durationMinutes: 60 } as Partial<AgencyTaskTimeEntry>,
    ];
    const client = await clientItem(data);
    expect(client?.laborHours).toBe(1);
    expect(client?.laborCost).toBe(50);
  });

  it('prices subtask time with the subtask assignee hourly cost', async () => {
    const data = baseData();
    data.checklistItems = [
      {
        id: 'subtask-1',
        taskId: 'task-1',
        assigneeId: 'member-2',
        taskTypeId: 'design',
      } as Partial<AgencyTaskChecklistItem>,
    ];
    data.timeEntries = [
      {
        taskId: 'task-1',
        checklistItemId: 'subtask-1',
        userId: 'user-1',
        durationMinutes: 120,
      } as Partial<AgencyTaskTimeEntry>,
    ];
    data.members = [
      {
        id: 'member-1',
        userId: 'user-1',
        displayName: 'Ana Dev',
        hourlyCost: '50.00',
        monthlyCost: null,
        metadata: {},
      } as Partial<TeamMember>,
      {
        id: 'member-2',
        userId: 'user-2',
        displayName: 'Bia Design',
        hourlyCost: '80.00',
        monthlyCost: null,
        metadata: {},
      } as Partial<TeamMember>,
    ];

    const client = await clientItem(data);
    expect(client?.laborHours).toBe(2);
    expect(client?.laborCost).toBe(160);
  });

  it('groups client hours by the subtask type when a time entry belongs to a subtask', async () => {
    const data = baseData({
      projectSettings: [
        {
          taskTypes: [
            { id: 'strategy', name: 'Estratégia' },
            { id: 'design', name: 'Design' },
          ],
        } as Partial<AgencyProjectSettings>,
      ],
      tasks: [
        {
          id: 'task-1',
          projectId: 'proj-1',
          clientId: null,
          assigneeId: 'member-1',
          trackedMinutes: 0,
          taskTypeId: 'strategy',
        } as Partial<AgencyTask>,
      ],
      checklistItems: [
        {
          id: 'subtask-1',
          taskId: 'task-1',
          assigneeId: 'member-1',
          taskTypeId: 'design',
        } as Partial<AgencyTaskChecklistItem>,
      ],
      timeEntries: [
        {
          taskId: 'task-1',
          checklistItemId: 'subtask-1',
          userId: 'user-1',
          durationMinutes: 90,
        } as Partial<AgencyTaskTimeEntry>,
      ],
    });

    const detail = await makeService(data).getClientDetail(ctx(), CLIENT);
    expect(detail.hoursByTaskType).toEqual([
      { taskType: 'Design', minutes: 90, hours: 1.5 },
    ]);
  });
});

// ── Monthly profitability series ───────────────────────────────────────────────

const CC_CLIENT = {
  id: 'cc-client',
  relatedEntityType: 'client',
  relatedEntityId: CLIENT,
} as Partial<FinanceCostCenter>;

const MEMBER_50 = {
  id: 'member-1',
  userId: 'user-1',
  displayName: 'Ana Dev',
  hourlyCost: '50.00',
  monthlyCost: null,
  metadata: {},
} as Partial<TeamMember>;

// Minimal workspace for the monthly series: a client cost center, one project
// and a member that costs R$ 50/h. Movement (invoices/bills/time) is added per
// test so each figure can be asserted in its own month.
function monthlyData(overrides: Partial<Data> = {}): Data {
  return {
    costCenters: [CC_CLIENT],
    projects: [{ id: 'proj-1', name: 'Projeto X', clientId: CLIENT }],
    tasks: [],
    timeEntries: [],
    members: [MEMBER_50],
    invoices: [],
    bills: [],
    billLines: [],
    ...overrides,
  };
}

type MonthlyResult = Awaited<
  ReturnType<FinanceProfitabilityService['getClientMonthlyProfitability']>
>;

async function monthlySeries(
  data: Data,
  options: { startMonth?: string; endMonth?: string; months?: number } = {
    startMonth: '2026-01',
    endMonth: '2026-12',
  },
): Promise<MonthlyResult> {
  const service = makeService(data);
  return service.getClientMonthlyProfitability(ctx(), CLIENT, options);
}

function pointFor(result: MonthlyResult, month: string) {
  return result.series.find((point) => point.month === month);
}

function utcDate(year: number, monthIndex0: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex0, day));
}

describe('FinanceProfitabilityService — monthly series', () => {
  it('defaults to the trailing 12 months ending in the current month', async () => {
    const service = makeService(monthlyData());
    const result = await service.getClientMonthlyProfitability(ctx(), CLIENT, {});
    expect(result.series).toHaveLength(12);
    expect(result.period.months).toBe(12);
    expect(result.series[result.series.length - 1].month).toBe(
      new Date().toISOString().slice(0, 7),
    );
  });

  it('honours an explicit months count', async () => {
    const service = makeService(monthlyData());
    const result = await service.getClientMonthlyProfitability(ctx(), CLIENT, {
      months: 6,
    });
    expect(result.series).toHaveLength(6);
  });

  it('fills months without movement with zero and keeps the series continuous', async () => {
    const result = await monthlySeries(monthlyData());
    expect(result.series).toHaveLength(12);
    const empty = pointFor(result, '2026-03');
    expect(empty).toMatchObject({
      revenue: 0,
      directCost: 0,
      laborCost: 0,
      directProfit: 0,
      directMargin: 0,
      hoursLogged: 0,
    });
  });

  it('places confirmed revenue in the issue-date month', async () => {
    const result = await monthlySeries(
      monthlyData({
        invoices: [
          {
            id: 'inv-1',
            customerId: CLIENT,
            status: 'issued' as FinanceInvoice['status'],
            totalAmount: '2500.00',
            issueDate: '2026-07-10',
            createdAt: new Date(),
          } as Partial<FinanceInvoice>,
        ],
      }),
    );
    expect(pointFor(result, '2026-07')?.revenue).toBe(2500);
    expect(pointFor(result, '2026-06')?.revenue).toBe(0);
  });

  it('excludes draft/cancelled invoices and other customers from revenue', async () => {
    const result = await monthlySeries(
      monthlyData({
        invoices: [
          {
            id: 'inv-ok',
            customerId: CLIENT,
            status: 'issued' as FinanceInvoice['status'],
            totalAmount: '2500.00',
            issueDate: '2026-07-10',
            createdAt: new Date(),
          } as Partial<FinanceInvoice>,
          {
            id: 'inv-draft',
            customerId: CLIENT,
            status: 'draft' as FinanceInvoice['status'],
            totalAmount: '9000.00',
            issueDate: '2026-07-11',
            createdAt: new Date(),
          } as Partial<FinanceInvoice>,
          {
            id: 'inv-other',
            customerId: 'other-client',
            status: 'issued' as FinanceInvoice['status'],
            totalAmount: '8000.00',
            issueDate: '2026-07-12',
            createdAt: new Date(),
          } as Partial<FinanceInvoice>,
        ],
      }),
    );
    expect(pointFor(result, '2026-07')?.revenue).toBe(2500);
  });

  it('places direct cost in the competence month from bill metadata', async () => {
    const result = await monthlySeries(
      monthlyData({
        bills: [
          {
            id: 'bill-1',
            status: 'open' as FinanceBill['status'],
            costCenterId: 'cc-client',
            issueDate: '2026-05-01',
            createdAt: new Date(),
            metadata: { competencePeriod: '2026-08' },
          } as Partial<FinanceBill>,
        ],
        billLines: [
          {
            id: 'bl-1',
            billId: 'bill-1',
            totalAmount: '420.00',
            costCenterId: null,
            metadata: {},
          } as Partial<FinanceBillLine>,
        ],
      }),
    );
    // Competence (2026-08) wins over the issue date (2026-05).
    expect(pointFor(result, '2026-08')?.directCost).toBe(420);
    expect(pointFor(result, '2026-05')?.directCost).toBe(0);
  });

  it('falls back to the bill date for direct-cost competence', async () => {
    const result = await monthlySeries(
      monthlyData({
        bills: [
          {
            id: 'bill-1',
            status: 'open' as FinanceBill['status'],
            costCenterId: 'cc-client',
            issueDate: '2026-04-15',
            createdAt: new Date(),
            metadata: {},
          } as Partial<FinanceBill>,
        ],
        billLines: [
          {
            id: 'bl-1',
            billId: 'bill-1',
            totalAmount: '100.00',
            costCenterId: null,
            metadata: {},
          } as Partial<FinanceBillLine>,
        ],
      }),
    );
    expect(pointFor(result, '2026-04')?.directCost).toBe(100);
  });

  it('excludes draft/cancelled bills from direct cost', async () => {
    const result = await monthlySeries(
      monthlyData({
        bills: [
          {
            id: 'bill-ok',
            status: 'open' as FinanceBill['status'],
            costCenterId: 'cc-client',
            issueDate: '2026-07-01',
            createdAt: new Date(),
            metadata: {},
          } as Partial<FinanceBill>,
          {
            id: 'bill-draft',
            status: 'draft' as FinanceBill['status'],
            costCenterId: 'cc-client',
            issueDate: '2026-07-02',
            createdAt: new Date(),
            metadata: {},
          } as Partial<FinanceBill>,
        ],
        billLines: [
          {
            id: 'bl-ok',
            billId: 'bill-ok',
            totalAmount: '300.00',
            costCenterId: null,
            metadata: {},
          } as Partial<FinanceBillLine>,
          {
            id: 'bl-draft',
            billId: 'bill-draft',
            totalAmount: '9000.00',
            costCenterId: null,
            metadata: {},
          } as Partial<FinanceBillLine>,
        ],
      }),
    );
    expect(pointFor(result, '2026-07')?.directCost).toBe(300);
  });

  it('places labor in the time-entry month and prices it with the member rate', async () => {
    const result = await monthlySeries(
      monthlyData({
        tasks: [
          {
            id: 'task-1',
            projectId: 'proj-1',
            clientId: null,
            assigneeId: 'member-1',
            trackedMinutes: 0,
          } as Partial<AgencyTask>,
        ],
        timeEntries: [
          {
            taskId: 'task-1',
            userId: 'user-1',
            durationMinutes: 120,
            startedAt: utcDate(2026, 2, 10),
          } as Partial<AgencyTaskTimeEntry>,
        ],
      }),
    );
    const march = pointFor(result, '2026-03');
    expect(march?.hoursLogged).toBe(2);
    expect(march?.laborCost).toBe(100); // 2h × R$ 50
  });

  it('prices monthly subtask labor with the subtask assignee rate', async () => {
    const result = await monthlySeries(
      monthlyData({
        members: [
          MEMBER_50,
          {
            id: 'member-2',
            userId: 'user-2',
            displayName: 'Bia Design',
            hourlyCost: '80.00',
            monthlyCost: null,
            metadata: {},
          } as Partial<TeamMember>,
        ],
        tasks: [
          {
            id: 'task-1',
            projectId: 'proj-1',
            clientId: null,
            assigneeId: 'member-1',
            trackedMinutes: 0,
          } as Partial<AgencyTask>,
        ],
        checklistItems: [
          {
            id: 'subtask-1',
            taskId: 'task-1',
            assigneeId: 'member-2',
          } as Partial<AgencyTaskChecklistItem>,
        ],
        timeEntries: [
          {
            taskId: 'task-1',
            checklistItemId: 'subtask-1',
            userId: 'user-1',
            durationMinutes: 120,
            startedAt: utcDate(2026, 2, 10),
          } as Partial<AgencyTaskTimeEntry>,
        ],
      }),
    );

    const march = pointFor(result, '2026-03');
    expect(march?.hoursLogged).toBe(2);
    expect(march?.laborCost).toBe(160);
  });

  it('buckets trackedMinutes fallback by the task completion month', async () => {
    const result = await monthlySeries(
      monthlyData({
        tasks: [
          {
            id: 'task-1',
            projectId: 'proj-1',
            clientId: null,
            assigneeId: 'member-1',
            trackedMinutes: 60,
            completedAt: utcDate(2026, 5, 20),
            updatedAt: new Date(),
            createdAt: new Date(),
          } as Partial<AgencyTask>,
        ],
        timeEntries: [],
      }),
    );
    const june = pointFor(result, '2026-06');
    expect(june?.hoursLogged).toBe(1);
    expect(june?.laborCost).toBe(50);
  });

  it('flags hours without cost per month and in the summary', async () => {
    const result = await monthlySeries(
      monthlyData({
        members: [
          {
            id: 'member-1',
            userId: 'user-1',
            displayName: 'Ana Dev',
            hourlyCost: null,
            monthlyCost: null,
            metadata: {},
          } as Partial<TeamMember>,
        ],
        tasks: [
          {
            id: 'task-1',
            projectId: 'proj-1',
            clientId: null,
            assigneeId: 'member-1',
            trackedMinutes: 0,
          } as Partial<AgencyTask>,
        ],
        timeEntries: [
          {
            taskId: 'task-1',
            userId: 'user-1',
            durationMinutes: 120,
            startedAt: utcDate(2026, 2, 10),
          } as Partial<AgencyTaskTimeEntry>,
        ],
      }),
    );
    const march = pointFor(result, '2026-03');
    expect(march?.laborCost).toBe(0);
    expect(march?.hoursWithoutCost).toBe(2);
    expect(march?.entriesWithoutCostCount).toBe(1);
    expect(march?.membersMissingCost).toContain('Ana Dev');
    expect(result.summary.hoursWithoutCost).toBe(2);
    expect(result.summary.membersMissingCost).toContain('Ana Dev');
  });

  it('computes directProfit and a non-100% directMargin when there are costs', async () => {
    const result = await monthlySeries(
      monthlyData({
        invoices: [
          {
            id: 'inv-1',
            customerId: CLIENT,
            status: 'issued' as FinanceInvoice['status'],
            totalAmount: '1000.00',
            issueDate: '2026-07-10',
            createdAt: new Date(),
          } as Partial<FinanceInvoice>,
        ],
        bills: [
          {
            id: 'bill-1',
            status: 'open' as FinanceBill['status'],
            costCenterId: 'cc-client',
            issueDate: '2026-07-05',
            createdAt: new Date(),
            metadata: {},
          } as Partial<FinanceBill>,
        ],
        billLines: [
          {
            id: 'bl-1',
            billId: 'bill-1',
            totalAmount: '300.00',
            costCenterId: null,
            metadata: {},
          } as Partial<FinanceBillLine>,
        ],
        tasks: [
          {
            id: 'task-1',
            projectId: 'proj-1',
            clientId: null,
            assigneeId: 'member-1',
            trackedMinutes: 0,
          } as Partial<AgencyTask>,
        ],
        timeEntries: [
          {
            taskId: 'task-1',
            userId: 'user-1',
            durationMinutes: 120,
            startedAt: utcDate(2026, 6, 10),
          } as Partial<AgencyTaskTimeEntry>,
        ],
      }),
    );
    const july = pointFor(result, '2026-07');
    expect(july?.directProfit).toBe(600); // 1000 - 300 - 100
    expect(july?.directMargin).toBe(60);
    expect(july?.directMargin).not.toBe(100);
  });

  it('returns margin 0 (not 100%) when there is cost but no revenue', async () => {
    const result = await monthlySeries(
      monthlyData({
        bills: [
          {
            id: 'bill-1',
            status: 'open' as FinanceBill['status'],
            costCenterId: 'cc-client',
            issueDate: '2026-09-05',
            createdAt: new Date(),
            metadata: {},
          } as Partial<FinanceBill>,
        ],
        billLines: [
          {
            id: 'bl-1',
            billId: 'bill-1',
            totalAmount: '300.00',
            costCenterId: null,
            metadata: {},
          } as Partial<FinanceBillLine>,
        ],
      }),
    );
    const september = pointFor(result, '2026-09');
    expect(september?.revenue).toBe(0);
    expect(september?.directProfit).toBe(-300);
    expect(september?.directMargin).toBe(0);
  });
});
