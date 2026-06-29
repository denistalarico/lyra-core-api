import { ObjectLiteral, Repository } from 'typeorm';
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
  timeEntries?: Partial<AgencyTaskTimeEntry>[];
  invoices?: Partial<FinanceInvoice>[];
  bills?: Partial<FinanceBill>[];
  billLines?: Partial<FinanceBillLine>[];
  costCenters?: Partial<FinanceCostCenter>[];
  members?: Partial<TeamMember>[];
  recurringProfiles?: Partial<FinanceRecurringProfile>[];
};

function makeService(data: Data) {
  const repo = <T extends ObjectLiteral>(rows: Partial<T>[] = []) =>
    ({
      find: jest.fn().mockResolvedValue(rows),
      findOne: jest.fn().mockResolvedValue(null),
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
    repo<AgencyTaskTimeEntry>(data.timeEntries),
    repo<AgencyProjectSettings>([]),
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
});
