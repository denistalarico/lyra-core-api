import type { ProjectsDashboardOverview } from '../../projects/types';
import type { CalendarDashboardSummary } from '../../calendar/types';
import type { TeamDashboardSummary } from '../../team/types';

export type AgencyDashboardPreset = 'executive' | 'management' | 'member';

export type AgencyDashboardAccess = {
  canViewDashboard: boolean;
  canViewFinance: boolean;
  canViewProfitability: boolean;
  canViewCommercial: boolean;
  canViewTeam: boolean;
  canViewPortfolio: boolean;
  canViewCrossProductSignals: boolean;
  canManageLayout: boolean;
};

export type AgencyDashboardPrioritySeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'info';

export type AgencyDashboardPriorityType =
  | 'overdue_project'
  | 'project_due_soon'
  | 'project_without_owner'
  | 'high_priority_project'
  | 'overdue_task'
  | 'task_due_today'
  | 'task_due_soon'
  | 'blocked_task'
  | 'task_without_assignee'
  | 'high_priority_task'
  | 'overdue_receivables'
  | 'high_default_rate'
  | 'negative_net_margin'
  | 'below_break_even'
  | 'overdue_activities'
  | 'client_health_critical'
  | 'client_health_attention'
  | 'client_health_unknown';

export type AgencyDashboardPriority = {
  id: string;
  type: AgencyDashboardPriorityType;
  severity: AgencyDashboardPrioritySeverity;
  title: string;
  description: string;
  sourceModule:
    | 'projects'
    | 'tasks'
    | 'finance'
    | 'activities'
    | 'clients';
  href: string;
  entityId: string;
  dueAt: string | null;
  score: number;
};

export type AgencyDashboardPartialFailure = {
  source: string;
  message: string;
};

export type AgencyDashboardTrendMarket = 'US' | 'BR';

export type AgencyDashboardTrendPlaceholder = {
  status: 'pending_integration';
  markets: AgencyDashboardTrendMarket[];
  items: [];
};

export type AgencyDashboardCalendarPlaceholder = {
  status: 'pending_integration';
  markets: AgencyDashboardTrendMarket[];
  items: [];
};

export type AgencyDashboardDailyTipPlaceholder = {
  status: 'pending_integration';
  item: null;
};

export type AgencyDashboardFinanceWidget = {
  currency: string;
  period: {
    type: string;
    start: string;
    end: string;
  };
  status: string;
  metrics: {
    mrr: number;
    revenueIssued: number;
    revenueReceived: number;
    openReceivables: number;
    overdueReceivables: number;
    defaultRate: number;
    averageTicket: number;
    fixedCosts: number;
    variableCosts: number;
    grossMargin: number;
    netMargin: number;
    breakEvenPoint: number;
    activeContracts: number;
  };
  counts: {
    invoices: number;
    monthInvoices: number;
    bills: number;
    monthBills: number;
    recurringProfiles: number;
    activeRecurringProfiles: number;
  };
};

export type AgencyDashboardProfitabilityWidget = Record<string, unknown>;

export type AgencyDashboardClientsWidget = {
  total: number;
  active: number;
  archived: number;
  byStatus: Record<string, number>;
  byLifecycleStage: Record<string, number>;
  byHealthStatus: Record<string, number>;

  profitabilitySummary: {
    officialClients: number;
    linkedClients: number;
    unlinkedFinancialClients: number;
    clientsWithoutProfitabilityData: number;
  };

  profitability: Record<string, unknown> | null;
};

export type AgencyDashboardSalesWidget = {
  items: number;
  pipelines: number;
  opportunities: number;
  quotes: number;
};

export type AgencyDashboardActivityItem = {
  id: string;
  type: string;
  summary: string;
  assignedToId: string | null;
  assignedToName: string | null;
  dueAt: string | null;
  overdue: boolean;
  href: string;
};

export type AgencyDashboardActivitiesWidget = {
  total: number;
  byStatus: Record<string, number>;
  overdue: number;
  myOpen: number;
  items: AgencyDashboardActivityItem[];
};

export type AgencyDashboardOverviewResponse = {
  generatedAt: string;

  product: {
    key: 'agency';
    moduleKey: 'agency.dashboard';
    entitlementStatus: string;
  };

  context: {
    tenantId: string;
    workspaceId: string;
    accountType: string;
    accountStatus: string;
    accountDisplayName: string | null;
    managedTenantId: null;
    agencyClientId: null;
  };

  user: {
    id: string;
    role: string;
    preset: AgencyDashboardPreset;
  };

  access: AgencyDashboardAccess;

  greeting: {
    attentionCount: number;
    messageKey:
      | 'dashboard.attention'
      | 'dashboard.stable'
      | 'dashboard.personalAttention';
  };

  priorities: AgencyDashboardPriority[];

  widgets: {
    projects: ProjectsDashboardOverview | null;
    finance: AgencyDashboardFinanceWidget | null;
    profitability: AgencyDashboardProfitabilityWidget | null;
    clients: AgencyDashboardClientsWidget | null;
    sales: AgencyDashboardSalesWidget | null;
    activities: AgencyDashboardActivitiesWidget | null;
    calendar: CalendarDashboardSummary | null;
    team: TeamDashboardSummary | null;
  };

  opportunities: {
    trends: AgencyDashboardTrendPlaceholder;
    dates: AgencyDashboardCalendarPlaceholder;
    dailyTip: AgencyDashboardDailyTipPlaceholder;
  };

  partialFailures: AgencyDashboardPartialFailure[];
};
