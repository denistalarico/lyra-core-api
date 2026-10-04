/**
 * PD4 — the contract of the agency self-context executive overview.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a second analytics engine. Every number here is read from the canonical
 * source that already computes it for the Agency surface
 * (`AgencyDashboardsService.getOverview`), and projected field by field. No
 * metric is recalculated, re-summed or re-classified on the way out (§5, §9,
 * §10).
 *
 * WHY A SLICE CARRIES A STATUS
 * ----------------------------
 * `'unavailable'` and a zero are different facts, and conflating them is the
 * failure mode §7 forbids: a workspace with no invoices and a Finance query
 * that failed must not render the same "R$ 0,00". So a slice is a discriminated
 * union — `ok` carries data, `unavailable` carries a reason and no numbers at
 * all. There is no partially-filled slice and no nullable metric standing in
 * for "we don't know".
 */

/** Why a slice has no data. Coarse on purpose — never an internal message. */
export const CLIENT_AREA_SELF_SLICE_REASONS = [
  /** The canonical source threw; the Agency dashboard reports it too. */
  'source_failed',
  /** The source answered, but this role/plan does not include the domain. */
  'not_available',
] as const;
export type ClientAreaSelfSliceReason =
  (typeof CLIENT_AREA_SELF_SLICE_REASONS)[number];

export type ClientAreaSelfSlice<TData> =
  | ({ status: 'ok' } & TData)
  | { status: 'unavailable'; reason: ClientAreaSelfSliceReason };

/**
 * The period every slice describes.
 *
 * V1 is the current calendar month and nothing else, because that is what the
 * canonical sources compute: `FinanceService.getReportsOverview` and
 * `FinanceProfitabilityService.getOverview` both derive the month from
 * `new Date()` and accept no range (§8). Offering a selector the backend
 * cannot honour would mean either lying or re-summing the ledger here, and
 * re-summing is exactly what PD4 must not do.
 *
 * `start`/`end` are plain `YYYY-MM-DD`, copied from the source's own period so
 * the label can never disagree with the figures underneath it.
 */
export type ClientAreaSelfPeriod = {
  type: 'current_month';
  start: string;
  end: string;
};

export type ClientAreaSelfFinance = {
  currency: string;
  revenueIssued: number;
  revenueReceived: number;
  expenses: number;
  result: number;
  openReceivables: number;
  overdueReceivables: number;
};

export type ClientAreaSelfProfitability = {
  currency: string;
  revenue: number;
  cost: number;
  grossProfit: number;
  /** A ratio (0.32), not a percentage. Formatted by the client. */
  margin: number;
  /** Canonical classification from the configured margin thresholds. */
  health: string | null;
};

export type ClientAreaSelfOperations = {
  activeProjects: number;
  overdueProjects: number;
  openTasks: number;
  overdueTasks: number;
  dueTodayTasks: number;
  openActivities: number;
  overdueActivities: number;
};

export type ClientAreaSelfClients = {
  total: number;
  active: number;
  archived: number;
  onboarding: number;
  offboarding: number;
};

export type ClientAreaSelfAlert = {
  /**
   * Stable within one response, for React keys. Derived from the canonical
   * priority id, which for aggregate-derived alerts is a constant slug and
   * never an entity id; project/task alerts are excluded precisely because
   * theirs are real ids (§21).
   */
  key: string;
  severity: 'critical' | 'high' | 'medium' | 'info';
  title: string;
  description: string;
  source: 'finance' | 'clients' | 'activities';
};

/**
 * The response body of `GET /client-area/self/overview`.
 *
 * Deliberately has no `tenantId`, `workspaceId`, `userId`, `agencyClientId`,
 * `companyContextId`, `selfAccessId`, `sessionId`, entity id, storage key or
 * Agency href anywhere in it — not by filtering, but because nothing of the
 * sort is ever written into it (§21).
 */
export type ClientAreaSelfOverviewResponse = {
  generatedAt: string;
  agencyDisplayName: string;
  period: ClientAreaSelfPeriod;
  finance: ClientAreaSelfSlice<ClientAreaSelfFinance>;
  profitability: ClientAreaSelfSlice<ClientAreaSelfProfitability>;
  operations: ClientAreaSelfSlice<ClientAreaSelfOperations>;
  clients: ClientAreaSelfSlice<ClientAreaSelfClients>;
  alerts: ClientAreaSelfSlice<{ items: ClientAreaSelfAlert[] }>;
};
