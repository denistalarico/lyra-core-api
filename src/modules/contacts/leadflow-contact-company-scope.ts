import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import type { RequestContext } from '../../common/context/request-context.interface';

/** Operational ownership, distinct from the person's employer/PF-PJ eligibility links. */
export function leadFlowContactCompany(ctx: RequestContext) {
  if (
    ctx.managedContext?.productKey !== 'leadflow' ||
    ctx.managedContext.operatingMode !== 'client'
  )
    return null;
  const scope = resolveCompanyAwareScope(ctx);
  // The resolver already rejects incomplete client mode; preserve that narrowing in the type.
  if (!scope.agencyClientId || !scope.companyContextId)
    throw new NotFoundException('Contact not found.');
  return {
    ...scope,
    agencyClientId: scope.agencyClientId,
    companyContextId: scope.companyContextId,
  };
}

export async function assertLeadFlowContactCompany(
  manager: EntityManager,
  ctx: RequestContext,
  contactId: string,
  agencyOperational = false,
) {
  const scope = leadFlowContactCompany(ctx);
  if (!scope) {
    // The Agency's shared contact directory still sees canonical contacts. Its own operational
    // CRM/Inbox cannot adopt another company's contact (and must return 404 before the DB guard).
    if (
      agencyOperational &&
      (
        await manager.query<unknown[]>(
          'SELECT contact_id FROM leadflow_contact_companies WHERE contact_id=$1',
          [contactId],
        )
      ).length
    )
      throw new NotFoundException('Contact not found.');
    return;
  }
  const rows = await manager.query<unknown[]>(
    `SELECT contact_id FROM leadflow_contact_companies WHERE tenant_id=$1 AND workspace_id=$2
      AND agency_client_id=$3 AND company_context_id=$4 AND contact_id=$5 AND scope_kind='company'`,
    [
      scope.tenantId,
      scope.workspaceId,
      scope.agencyClientId,
      scope.companyContextId,
      contactId,
    ],
  );
  if (!rows.length) throw new NotFoundException('Contact not found.');
}
