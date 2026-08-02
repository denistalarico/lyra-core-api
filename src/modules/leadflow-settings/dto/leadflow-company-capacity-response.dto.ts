import type { TenantProductEntitlementEntity } from '../../platform';

export type LeadFlowCompanyCapacityResponse = {
  activeCompanies: number;
  limit: number | null;
  availableSlots: number | null;
  planKey: string | null;
  entitlementStatus: string | null;
};

export function mapLeadFlowCompanyCapacityResponse(
  activeCompanies: number,
  limit: number | null,
  entitlement: TenantProductEntitlementEntity | null,
): LeadFlowCompanyCapacityResponse {
  return {
    activeCompanies,
    limit,
    availableSlots: limit === null ? null : Math.max(limit - activeCompanies, 0),
    planKey: entitlement?.planKey ?? null,
    entitlementStatus: entitlement?.status ?? null,
  };
}
