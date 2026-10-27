import { ForbiddenException } from '@nestjs/common';

/**
 * CA-AN1 — who is asking, for the private Owner dashboards (D-AN-14) and the
 * agency-owned rows (D-AN-8), in both LeadFlow and Social. `clientAreaUserId`
 * is the Client Area principal (null for the Agency, including the agency
 * self-context): it sees the shared rows plus its own private ones; the
 * Agency sees shared rows only.
 */
export type AnalyticsDashboardPrincipal = { clientAreaUserId: string | null };
export const AGENCY_DASHBOARD_PRINCIPAL: AnalyticsDashboardPrincipal = {
  clientAreaUserId: null,
};

/** The principal of a request: the Client Area user when the Bridge set one. */
export function analyticsDashboardPrincipal(request: {
  clientAreaContext?: { userId: string };
}): AnalyticsDashboardPrincipal {
  return { clientAreaUserId: request.clientAreaContext?.userId ?? null };
}

/**
 * CA-AN1 (D-AN-8, D-AN-13) — what a Client Area principal may change. The
 * Visão Geral is the agency's alone; a shared channel screen takes only a new
 * layout (its cards); any other shared row is the agency's; a private row is
 * the Owner's own. `dto` null = a delete. The Agency is never limited here.
 */
export function assertClientAreaMayChange(
  row: {
    isDefault: boolean;
    channelKey: string | null;
    clientAreaOwnerUserId: string | null;
  },
  principal: AnalyticsDashboardPrincipal,
  dto: object | null,
): void {
  if (!principal.clientAreaUserId) return;
  if (row.isDefault)
    throw new ForbiddenException({
      code: 'analytics_overview_agency_owned',
      message: 'A Visão Geral é editada pela agência.',
    });
  if (row.clientAreaOwnerUserId) return;
  const layoutOnly =
    dto !== null &&
    Object.entries(dto).every(
      ([key, value]) => key === 'layout' || value === undefined,
    );
  if (!row.channelKey || !layoutOnly)
    throw new ForbiddenException({
      code: 'analytics_dashboard_agency_owned',
      message: 'Este dashboard é editado pela agência.',
    });
}
