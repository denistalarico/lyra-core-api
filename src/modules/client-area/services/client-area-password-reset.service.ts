import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { DataSource, IsNull } from 'typeorm';
import { AgencyIdentityCredentialsService } from '../../agency/agency-identity-credentials.service';
import {
  AgencyPasswordResetEntity,
  AgencyUserSecuritySettingsEntity,
} from '../../agency/entities/agency-auth.entities';
import { AgencyWorkspaceUserEntity } from '../../agency/entities/agency-settings.entities';
import { assertClientAreaEnabled } from '../client-area.config';
import { assertClientAreaPasswordPolicy } from '../client-area-password.policy';
import { CLIENT_AREA_ERROR_CODES } from '../client-area.types';
import { ClientAreaMembershipEntity } from '../entities/client-area-membership.entity';
import { ClientAreaAuthService } from './client-area-auth.service';
import { ClientAreaEmailService } from './client-area-email.service';
import {
  CLIENT_AREA_SURFACE,
  ClientAreaSessionService,
} from './client-area-session.service';

const AGENCY_CONNECTION = 'agency';
export const CLIENT_AREA_RESET_TTL_MINUTES = 30;

function resetTokenInvalid() {
  return new UnauthorizedException({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'Invalid or expired reset link.',
    code: CLIENT_AREA_ERROR_CODES.resetTokenInvalid,
  });
}

/**
 * CA2 — forgot/reset password of the Client Area.
 *
 * Reuses the `password_resets` storage of the Agency identity with
 * `surface='client_area'`; each surface redeems only its own links (the
 * Agency reset now filters `surface='agency'`). Tokens are random, stored as
 * sha256, expire in {@link CLIENT_AREA_RESET_TTL_MINUTES} minutes and are
 * single use; issuing a new link burns the previous unused ones.
 *
 * Only Client Area-eligible identities (active membership, not an Agency
 * operator) can request or redeem a link here. The answer of "forgot" never
 * depends on whether the email exists.
 */
@Injectable()
export class ClientAreaPasswordResetService {
  private readonly logger = new Logger(ClientAreaPasswordResetService.name);

  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    private readonly auth: ClientAreaAuthService,
    private readonly credentials: AgencyIdentityCredentialsService,
    private readonly emails: ClientAreaEmailService,
    private readonly sessions: ClientAreaSessionService,
    private readonly config: ConfigService,
  ) {}

  async forgotPassword(email: unknown) {
    assertClientAreaEnabled(this.config);

    const eligible = await this.auth.findEligibleIdentities(
      typeof email === 'string' ? email : '',
    );

    for (const identity of eligible) {
      try {
        await this.issue(identity);
      } catch (error) {
        // Swallowed on purpose: a failure only for existing accounts would
        // turn this endpoint into an account oracle.
        this.logger.warn(
          `Client Area reset email failed for ${identity.tenantId}/${identity.userId}: ${(error as Error)?.message}`,
        );
      }
    }

    return { success: true };
  }

  async resetPassword(
    token: unknown,
    password: unknown,
    passwordConfirmation: unknown,
  ) {
    assertClientAreaEnabled(this.config);

    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
      throw resetTokenInvalid();
    }

    await this.dataSource.transaction(async (manager) => {
      const resets = manager.getRepository(AgencyPasswordResetEntity);
      const reset = await resets.findOne({
        where: {
          tokenHash: this.credentials.hashToken(token),
          surface: CLIENT_AREA_SURFACE,
        },
        lock: { mode: 'pessimistic_write' },
      });

      if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now()) {
        throw resetTokenInvalid();
      }

      const security = manager.getRepository(AgencyUserSecuritySettingsEntity);
      const identity = await security.findOne({
        where: { tenantId: reset.tenantId, userId: reset.userId },
      });

      const eligible =
        identity &&
        (await manager.getRepository(ClientAreaMembershipEntity).exists({
          where: {
            tenantId: identity.tenantId,
            userId: identity.userId,
            status: 'active',
          },
        })) &&
        !(await manager.getRepository(AgencyWorkspaceUserEntity).exists({
          where: {
            tenantId: identity.tenantId,
            userId: identity.userId,
            status: 'active',
          },
        }));

      if (!identity || !eligible) {
        throw resetTokenInvalid();
      }

      const accepted = assertClientAreaPasswordPolicy({
        password,
        confirmation: passwordConfirmation,
        email: identity.currentEmail,
      });

      await security.update(
        { id: identity.id },
        {
          passwordHash: await this.credentials.hashPassword(accepted),
          passwordUpdatedAt: new Date(),
        },
      );
      await resets.update(
        {
          tenantId: reset.tenantId,
          userId: reset.userId,
          surface: CLIENT_AREA_SURFACE,
          usedAt: IsNull(),
        },
        { usedAt: new Date() },
      );
      // Every Client Area session of the person ends. Agency sessions are not
      // touched: by the XOR rule this identity has none.
      await this.sessions.revokeAll(
        identity.tenantId,
        identity.userId,
        manager,
      );
    });

    return { success: true };
  }

  private async issue(identity: AgencyUserSecuritySettingsEntity) {
    const token = randomBytes(32).toString('hex');

    await this.dataSource.transaction(async (manager) => {
      const resets = manager.getRepository(AgencyPasswordResetEntity);
      await resets.update(
        {
          tenantId: identity.tenantId,
          userId: identity.userId,
          surface: CLIENT_AREA_SURFACE,
          usedAt: IsNull(),
        },
        { usedAt: new Date() },
      );
      await resets.insert({
        tenantId: identity.tenantId,
        userId: identity.userId,
        tokenHash: this.credentials.hashToken(token),
        expiresAt: new Date(
          Date.now() + CLIENT_AREA_RESET_TTL_MINUTES * 60 * 1000,
        ),
        surface: CLIENT_AREA_SURFACE,
      });
    });

    await this.emails.sendPasswordReset({
      tenantId: identity.tenantId,
      to: identity.currentEmail,
      token,
      ttlMinutes: CLIENT_AREA_RESET_TTL_MINUTES,
    });
  }
}
