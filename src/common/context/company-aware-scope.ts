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

/**
 * CC2G — the single machine-readable rejection for a company-aware operation
 * reached without a Company Context.
 *
 * Before CC2G every boundary threw its own prose, so a client could only
 * pattern-match on message text. The UI needs to tell "you must pick a
 * company" apart from every other 400 in order to route the user to the
 * company switcher (CC2H), so the code — not the message — is the contract.
 *
 * Legacy selections (a client with no company) are still representable in the
 * frontend provider until CC2H, so this is the error they must receive:
 * a company-scoped endpoint never falls back to client-wide data.
 */
export const COMPANY_CONTEXT_REQUIRED = 'company_context_required';

/** Companion code for a client-mode request that carries no client at all. */
export const CLIENT_CONTEXT_REQUIRED = 'client_context_required';

/**
 * A `BadRequestException` whose body carries a stable `code`, alongside the
 * usual `message`/`statusCode` Nest produces.
 */
export class CompanyContextRequiredException extends BadRequestException {
  constructor(
    message = 'Company context is required for this operation.',
    code: string = COMPANY_CONTEXT_REQUIRED,
  ) {
    super({ statusCode: 400, message, error: 'Bad Request', code });
  }
}

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
    throw new CompanyContextRequiredException(
      'Client context is required.',
      CLIENT_CONTEXT_REQUIRED,
    );
  }
  if (!companyContextId) {
    // CC2G: client mode without a company never degrades to client-wide data.
    // Every migrated Social/LeadFlow boundary resolves its scope through this
    // function, so the enforcement is structural rather than per-endpoint.
    throw new CompanyContextRequiredException();
  }

  return {
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    agencyClientId,
    companyContextId,
  };
}
