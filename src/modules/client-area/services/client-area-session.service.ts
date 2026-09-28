import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, type EntityManager, Repository } from 'typeorm';
import {
  AgencyUserSecuritySettingsEntity,
  AgencyUserSessionEntity,
} from '../../agency/entities/agency-auth.entities';
import { AgencyWorkspaceUserEntity } from '../../agency/entities/agency-settings.entities';
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
    // an identity that became an Agency operator loses the Client Area.
    if (await this.isAgencyOperator(payload.tenantId, payload.sub)) {
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
