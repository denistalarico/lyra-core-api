import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type EntityManager, Repository } from 'typeorm';
import {
  AgencyUserSecuritySettingsEntity,
  AgencyUserSessionEntity,
} from '../../agency/entities/agency-auth.entities';
import { AgencyWorkspaceUserEntity } from '../../agency/entities/agency-settings.entities';
import { ClientAreaSelfAccessEntity } from '../entities/client-area-self-access.entity';
import { ClientAreaSettingsEntity } from '../entities/client-area-settings.entity';
import { clientAreaSessionInvalidError } from '../strategies/client-area-jwt.strategy';
import type {
  ClientAreaIdentity,
  ClientAreaTokenPayload,
} from '../client-area.types';

const AGENCY_CONNECTION = 'agency';
export const CLIENT_AREA_SURFACE = 'client_area' as const;

/**
 * Live-session and identity checks of the Client Area, run on every request.
 *
 * Access tokens are stateless for 15 minutes; this is what makes revocation
 * (logout, membership revoke, password reset) effective on the next request
 * instead of at token expiry.
 */
@Injectable()
export class ClientAreaSessionService {
  constructor(
    @InjectRepository(AgencyUserSessionEntity, AGENCY_CONNECTION)
    private readonly sessionsRepo: Repository<AgencyUserSessionEntity>,
    @InjectRepository(AgencyUserSecuritySettingsEntity, AGENCY_CONNECTION)
    private readonly securityRepo: Repository<AgencyUserSecuritySettingsEntity>,
    @InjectRepository(AgencyWorkspaceUserEntity, AGENCY_CONNECTION)
    private readonly workspaceUsersRepo: Repository<AgencyWorkspaceUserEntity>,
    @InjectRepository(ClientAreaSelfAccessEntity, AGENCY_CONNECTION)
    private readonly selfAccessRepo: Repository<ClientAreaSelfAccessEntity>,
  ) {}

  async authenticate(
    payload: ClientAreaTokenPayload,
    now = new Date(),
  ): Promise<ClientAreaIdentity> {
    const session = await this.sessionsRepo.findOne({
      where: {
        id: payload.sessionId,
        tenantId: payload.tenantId,
        userId: payload.sub,
        surface: CLIENT_AREA_SURFACE,
      },
    });

    if (!session || !isLiveSession(session, now)) {
      throw clientAreaSessionInvalidError();
    }

    const identity = await this.securityRepo.findOne({
      where: { tenantId: payload.tenantId, userId: payload.sub },
    });

    if (!identity) {
      throw clientAreaSessionInvalidError();
    }

    // Separation of duties is re-checked at runtime, not only at grant time:
    // an identity that became an Agency operator loses the *external* Client
    // Area. PD3 §5 narrows this: an operator who holds an active agency
    // self access keeps the surface, as the agency itself. The external
    // membership prohibition is unchanged — a self holder still gets no
    // Company Context, because `ClientAreaMembershipGuard` resolves those
    // from `client_area_memberships`, which this never grants.
    if (
      (await this.isAgencyOperator(payload.tenantId, payload.sub)) &&
      !(await this.hasAgencySelfAccess(payload.tenantId, payload.sub))
    ) {
      throw clientAreaSessionInvalidError();
    }

    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      sessionId: payload.sessionId,
      email: identity.currentEmail,
    };
  }

  isAgencyOperator(tenantId: string, userId: string): Promise<boolean> {
    return this.workspaceUsersRepo.exists({
      where: { tenantId, userId, status: 'active' },
    });
  }

  /**
   * PD3 — does this identity hold an active agency self access whose
   * workspace has both the Client Area and the self-context switched on?
   *
   * Kept here, next to `isAgencyOperator`, so the dependency arrow stays
   * one-way: `ClientAreaSelfAccessService` depends on this service (for
   * session revocation), never the reverse. The full self-context
   * projection still belongs to that service; this is only the gate.
   */
  async hasAgencySelfAccess(
    tenantId: string,
    userId: string,
  ): Promise<boolean> {
    return (
      this.selfAccessRepo
        .createQueryBuilder('access')
        .innerJoin(
          ClientAreaSettingsEntity,
          'settings',
          `settings.tenant_id = access.tenant_id
          AND settings.workspace_id = access.workspace_id`,
        )
        .where('access.tenant_id = :tenantId', { tenantId })
        .andWhere('access.user_id = :userId', { userId })
        .andWhere(`access.status = 'active'`)
        .andWhere('settings.enabled = true')
        .andWhere('settings.self_enabled = true')
        // The holder must still be an active Agency operator of that same
        // workspace; an eligible role is re-checked by the self-access service.
        .andWhere(
          `EXISTS (SELECT 1 FROM workspace_users wu
                  WHERE wu.tenant_id = access.tenant_id
                    AND wu.workspace_id = access.workspace_id
                    AND wu.user_id = access.user_id
                    AND wu.status = 'active'
                    AND wu.role IN ('owner','admin'))`,
        )
        .getExists()
    );
  }

  /** Ends every Client Area session of a person (Agency sessions untouched). */
  async revokeAll(
    tenantId: string,
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager
      ? manager.getRepository(AgencyUserSessionEntity)
      : this.sessionsRepo;

    await repo.update(
      {
        tenantId,
        userId,
        surface: CLIENT_AREA_SURFACE,
        revokedAt: IsNull(),
      },
      { status: 'expired', revokedAt: new Date() },
    );
  }
}

export function isLiveSession(
  session: AgencyUserSessionEntity | null,
  now: Date,
): boolean {
  return Boolean(
    session &&
    session.surface === CLIENT_AREA_SURFACE &&
    !session.revokedAt &&
    session.status !== 'expired' &&
    (!session.expiresAt || session.expiresAt.getTime() > now.getTime()),
  );
}
