import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from './request-context.interface';

/**
 * Persisted operational scope introduced by CC2C.
 *
 * The pair is intentional: `(null, null)` is agency scope, both ids set is a
 * company scope, and `(agencyClientId, null)` is reserved for historical
 * `legacy_unassigned` rows. Operational client-mode requests never receive
 * that legacy shape.
 */
export type CompanyAwareScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  companyContextId: string | null;
};

export function resolveCompanyAwareScope(
  ctx: RequestContext,
): CompanyAwareScope {
  if (!ctx.tenantId || !ctx.workspaceId) {
    throw new BadRequestException('Tenant and workspace context are required.');
  }

  if (ctx.managedContext?.operatingMode !== 'client') {
    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      agencyClientId: null,
      companyContextId: null,
    };
  }

  const agencyClientId = ctx.managedContext.clientId ?? null;
  const companyContextId = ctx.managedContext.companyContextId ?? null;

  if (!agencyClientId) {
    throw new BadRequestException('Client context is required.');
  }
  if (!companyContextId) {
    throw new BadRequestException(
      'Company context is required for this operation.',
    );
  }

  return {
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    agencyClientId,
    companyContextId,
  };
}
