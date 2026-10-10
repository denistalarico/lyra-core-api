import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AgencyWorkspaceUserEntity } from '../../modules/agency/entities/agency-settings.entities';
import type { AuthTokenPayload } from '../../modules/auth/types/auth-token-payload.type';

const AGENCY_CONNECTION = 'agency';

/**
 * Tenant/workspace/user a request *asks* for through the legacy context
 * headers. A request, never authority: it is compared with the verified token
 * and otherwise ignored.
 */
export interface RequestedTenantContext {
  tenantId?: string | null;
  workspaceId?: string | null;
  userId?: string | null;
}

export type TenantContextChannel = 'http' | 'socket';

export type TenantContextHeaders = Record<
  string,
  string | string[] | undefined
>;

type RejectionReason = 'context_mismatch' | 'no_active_membership';

/** Identical for every refusal: it names no tenant, workspace or membership. */
const REJECTION_MESSAGE = 'Request context is not authorized.';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readHeader(headers: TenantContextHeaders, name: string) {
  const raw = headers[name];
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  return value ? value : null;
}

export function readRequestedTenantContext(
  headers: TenantContextHeaders,
): RequestedTenantContext {
  return {
    tenantId: readHeader(headers, 'x-tenant-id'),
    workspaceId: readHeader(headers, 'x-workspace-id'),
    userId: readHeader(headers, 'x-user-id'),
  };
}

/**
 * SEC-A1 — the single authority for "which tenant/workspace is this request
 * operating, and as whom".
 *
 *   verified JWT (tenant, workspace, user)
 *     → active Agency `workspace_users` membership for exactly that triple
 *     → authorized context (role taken from the membership)
 *
 * The browser may still send `x-tenant-id`/`x-workspace-id`/`x-user-id` to
 * *select* a context, but a value that differs from the token is refused with
 * 403 rather than ignored, because it means either an attack or a frontend
 * that believes it is somewhere it is not. Managed clients are not selected
 * here: an agency operates a client from its own tenant through
 * `OperationalContextResolver`, never by naming the client's tenant.
 *
 * Used by `JwtStrategy` (every `JwtAuthGuard` route) and by the WebSocket
 * gateways that verify the same access token themselves.
 */
@Injectable()
export class TenantContextAuthority {
  private readonly logger = new Logger(TenantContextAuthority.name);

  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly agencyDataSource: DataSource,
  ) {}

  async authorize(
    payload: AuthTokenPayload,
    requested: RequestedTenantContext = {},
    channel: TenantContextChannel = 'http',
  ): Promise<AuthTokenPayload> {
    if (!payload?.sub || !payload.tenantId || !payload.workspaceId) {
      throw new UnauthorizedException('Invalid access token');
    }

    const mismatch =
      this.differs(requested.tenantId, payload.tenantId) ||
      this.differs(requested.workspaceId, payload.workspaceId) ||
      this.differs(requested.userId, payload.sub);

    if (mismatch) {
      this.reject('context_mismatch', payload, requested, channel);
    }

    const membership = await this.agencyDataSource
      .getRepository(AgencyWorkspaceUserEntity)
      .findOne({
        select: { id: true, role: true },
        where: {
          tenantId: payload.tenantId,
          workspaceId: payload.workspaceId,
          userId: payload.sub,
          status: 'active',
        },
      });

    if (!membership) {
      this.reject('no_active_membership', payload, requested, channel);
    }

    // The role in the token is a snapshot from login/refresh; the membership
    // is the live grant, so a demotion takes effect on the next request.
    return { ...payload, role: membership.role };
  }

  private differs(requested: string | null | undefined, actual: string) {
    return (
      typeof requested === 'string' &&
      requested.length > 0 &&
      requested.toLowerCase() !== actual.toLowerCase()
    );
  }

  private reject(
    reason: RejectionReason,
    payload: AuthTokenPayload,
    requested: RequestedTenantContext,
    channel: TenantContextChannel,
  ): never {
    this.logger.warn(
      JSON.stringify({
        event: 'tenant_context_rejected',
        reason,
        channel,
        userId: payload.sub,
        authenticatedTenantId: payload.tenantId,
        authenticatedWorkspaceId: payload.workspaceId,
        requestedTenantId: this.loggable(requested.tenantId),
        requestedWorkspaceId: this.loggable(requested.workspaceId),
        requestedUserId: this.loggable(requested.userId),
      }),
    );
    throw new ForbiddenException(REJECTION_MESSAGE);
  }

  /** Header values are attacker-controlled: log ids only, never raw text. */
  private loggable(value: string | null | undefined) {
    if (!value) return null;
    return UUID_PATTERN.test(value) ? value : '[not-a-uuid]';
  }
}
