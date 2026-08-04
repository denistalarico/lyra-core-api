export type LeadFlowOverviewOperatingContext = {
  operatingMode: 'agency' | 'client';
  clientId: string | null;
};

export type LeadFlowOverviewWindow = {
  from: string;
  to: string;
};

export type LeadFlowOverviewKpiKey =
  | 'first_response_rate'
  | 'first_response_time_seconds'
  | 'hot_lead_transitions'
  | 'commercial_win_rate'
  | 'automation_success_rate';

/**
 * Every KPI ships its own formula/source/window/limitation so the contract
 * is self-describing (LF-RF-F10-001 acceptance criteria) instead of relying
 * on out-of-band documentation the UI has no way to surface.
 */
export type LeadFlowOverviewKpi = {
  key: LeadFlowOverviewKpiKey;
  label: string;
  value: number | null;
  unit: 'percentage' | 'seconds' | 'count';
  formula: string;
  source: string;
  window: LeadFlowOverviewWindow;
  limitation: string;
};

export type LeadFlowOverviewDomainStatus =
  | 'ok'
  | 'attention'
  | 'critical'
  | 'no_data';

export type LeadFlowOverviewDomainKey = 'inbox' | 'crm' | 'automations';

export type LeadFlowOverviewDomainHealth = {
  status: LeadFlowOverviewDomainStatus;
  headline: string;
  detail: string;
  source: string;
  window: LeadFlowOverviewWindow;
  deepLink: string;
};

export type LeadFlowOverviewPrioritySeverity = 'critical' | 'warning' | 'info';

export type LeadFlowOverviewPriority = {
  key: string;
  severity: LeadFlowOverviewPrioritySeverity;
  title: string;
  detail: string;
  source: string;
  deepLink: string;
};

export type LeadFlowOverviewResponse = {
  generatedAt: string;
  window: LeadFlowOverviewWindow & { days: number };
  context: LeadFlowOverviewOperatingContext;
  kpis: LeadFlowOverviewKpi[];
  domainHealth: Record<LeadFlowOverviewDomainKey, LeadFlowOverviewDomainHealth>;
  priorities: LeadFlowOverviewPriority[];
};
