import { Request } from 'express';
import { getAuthorizedContext } from '../../../common/context/authorized-context.decorator';

export type FinanceRequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string | null;
};

/**
 * Finance's view of the authorized request context.
 *
 * SEC-A1: until 2026-10-10 this read `x-tenant-id`/`x-workspace-id`/`x-user-id`
 * straight from the request, so any valid JWT plus another tenant's headers
 * read (and wrote) that tenant's Finance. The context now comes only from the
 * token that `JwtStrategy` already checked against the headers and an active
 * membership; the headers are never consulted here.
 */
export function getFinanceContext(req: Request): FinanceRequestContext {
  const context = getAuthorizedContext(req);

  return {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    userId: context.userId,
  };
}
