import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedRequest } from '../../modules/auth/types/authenticated-request.type';

/**
 * The tenant/workspace/user/role a request operates as, after `JwtStrategy`
 * has run it through `TenantContextAuthority` (token verified, context headers
 * consistent with it, active membership, live role).
 *
 * This replaces every `x-tenant-id`/`x-workspace-id`/`x-user-id`/`x-user-role`
 * read in the Agency controllers: those headers are a request, never the
 * source of the context (SEC-A1).
 */
export interface AuthorizedRequestContext {
  tenantId: string;
  workspaceId: string;
  userId: string;
  role: string;
  sessionId: string;
}

/**
 * Reads the authorized context from a request that passed `JwtAuthGuard`.
 * Fails closed: without a verified user there is no default tenant.
 */
export function getAuthorizedContext(
  request: Request,
): AuthorizedRequestContext {
  const user = (request as Partial<AuthenticatedRequest>).user;

  if (!user?.sub || !user.tenantId || !user.workspaceId) {
    throw new UnauthorizedException('Authenticated context is required.');
  }

  return {
    tenantId: user.tenantId,
    workspaceId: user.workspaceId,
    userId: user.sub,
    role: user.role,
    sessionId: user.sessionId,
  };
}

export const AuthorizedContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthorizedRequestContext =>
    getAuthorizedContext(ctx.switchToHttp().getRequest<Request>()),
);
