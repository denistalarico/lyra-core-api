import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import type { Request } from 'express';
import { Repository } from 'typeorm';
import { AgencyIdentityCredentialsService } from '../../agency/agency-identity-credentials.service';
import {
  AgencyUserSecuritySettingsEntity,
  AgencyUserSessionEntity,
} from '../../agency/entities/agency-auth.entities';
import { AgencyUserProfileEntity } from '../../agency/entities/agency-settings.entities';
import {
  extractLoginContext,
  type LoginRequestContext,
} from '../../auth/utils/login-context.util';
import {
  assertClientAreaEnabled,
  resolveClientAreaAccessSecret,
} from '../client-area.config';
import {
  CLIENT_AREA_ERROR_CODES,
  CLIENT_AREA_TOKEN_TYPE,
  CLIENT_AREA_TWO_FACTOR_TOKEN_TYPE,
  normalizeClientAreaEmail,
  type ClientAreaTokenPayload,
  type ClientAreaTwoFactorTokenPayload,
} from '../client-area.types';
import { ClientAreaMembershipEntity } from '../entities/client-area-membership.entity';
import {
  CLIENT_AREA_SURFACE,
  ClientAreaSessionService,
  isLiveSession,
} from './client-area-session.service';
import { ClientAreaManagementService } from './client-area-management.service';

const AGENCY_CONNECTION = 'agency';
const ACCESS_TOKEN_TTL = '15m';
const TWO_FACTOR_TOKEN_TTL = '5m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ClientAreaUserResponse = {
  id: string;
  email: string;
  displayName: string;
};

export type ClientAreaAuthenticatedResponse = {
  accessToken: string;
  refreshToken: string;
  user: ClientAreaUserResponse;
};

export type ClientAreaTwoFactorChallenge = {
  requiresTwoFactor: true;
  method: 'email' | 'authenticator';
  tempToken: string;
};

function invalidCredentials() {
  return new UnauthorizedException({
    statusCode: 401,
    error: 'Unauthorized',
    message: 'Invalid credentials',
    code: CLIENT_AREA_ERROR_CODES.invalidCredentials,
  });
}

function sessionInvalid(message = 'Invalid Client Area session.') {
  return new UnauthorizedException({
    statusCode: 401,
    error: 'Unauthorized',
    message,
    code: CLIENT_AREA_ERROR_CODES.sessionInvalid,
  });
}

/**
 * CA1 — Client Area login, 2FA, refresh and logout.
 *
 * Reuses the Agency identity (`user_security_settings`) and its credential
 * primitives, but never Agency eligibility: a person may log in here only
 * with an active `client_area_memberships` row and **without** active
 * `workspace_users` in the tenant. Sessions are rows of `user_sessions`
 * tagged `surface='client_area'`; access tokens are signed with the dedicated
 * Client Area secret and marked `typ='client_area'`.
 *
 * Forgot/reset password and invitation acceptance (CA2) live in their own
 * services and reuse `findEligibleIdentities`/`createAuthenticatedSession`.
 * Not implemented: login alerts and trusted devices.
 */
@Injectable()
export class ClientAreaAuthService {
  constructor(
    @InjectRepository(AgencyUserSecuritySettingsEntity, AGENCY_CONNECTION)
    private readonly securityRepo: Repository<AgencyUserSecuritySettingsEntity>,
    @InjectRepository(AgencyUserSessionEntity, AGENCY_CONNECTION)
    private readonly sessionsRepo: Repository<AgencyUserSessionEntity>,
    @InjectRepository(ClientAreaMembershipEntity, AGENCY_CONNECTION)
    private readonly membershipsRepo: Repository<ClientAreaMembershipEntity>,
    @InjectRepository(AgencyUserProfileEntity, AGENCY_CONNECTION)
    private readonly profilesRepo: Repository<AgencyUserProfileEntity>,
    private readonly credentials: AgencyIdentityCredentialsService,
    private readonly sessions: ClientAreaSessionService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly management: ClientAreaManagementService,
  ) {}

  async login(
    email: string,
    password: string,
    req: Request,
  ): Promise<ClientAreaAuthenticatedResponse | ClientAreaTwoFactorChallenge> {
    assertClientAreaEnabled(this.configService);

    const client = extractLoginContext(req);
    const eligible = await this.findEligibleIdentities(email);
    const matched: AgencyUserSecuritySettingsEntity[] = [];

    for (const identity of eligible) {
      if (await this.credentials.verifyPassword(identity, password)) {
        matched.push(identity);
      }
    }

    if (matched.length === 0) {
      await Promise.all(
        eligible.map((identity) =>
          this.credentials.recordLoginEvent(
            identity.tenantId,
            identity.userId,
            'login_failed',
            client,
            CLIENT_AREA_SURFACE,
          ),
        ),
      );
      throw invalidCredentials();
    }

    // Ambiguity is only disclosed after a correct password. It fails closed:
    // the same email/password in two agencies (no tenant selector yet), or two
    // eligible identities sharing the email inside one tenant, never resolves
    // to "the most recent" one.
    const [identity] = matched;
    const matchedTenants = new Set(matched.map((entry) => entry.tenantId));
    const sameTenantEligible = eligible.filter(
      (entry) => entry.tenantId === identity.tenantId,
    );

    if (matchedTenants.size > 1 || sameTenantEligible.length > 1) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        message:
          'This email is linked to more than one Client Area account. Contact your agency.',
        code: CLIENT_AREA_ERROR_CODES.accountAmbiguous,
      });
    }

    if (this.credentials.hasTwoFactorEnabled(identity)) {
      return this.createTwoFactorChallenge(identity);
    }

    return this.createAuthenticatedSession(identity, client);
  }

  async loginWithTwoFactor(token: string, code: string, req: Request) {
    assertClientAreaEnabled(this.configService);

    const payload = await this.verifyTwoFactorToken(token);

    await this.credentials.verifyTwoFactorCode(
      payload.method,
      { tenantId: payload.tenantId, userId: payload.sub },
      typeof code === 'string' ? code : '',
    );

    const identity = await this.securityRepo.findOne({
      where: { tenantId: payload.tenantId, userId: payload.sub },
    });

    // Eligibility may have changed during the 5-minute challenge.
    if (!identity || !(await this.isEligible(identity))) {
      throw invalidCredentials();
    }

    return this.createAuthenticatedSession(identity, extractLoginContext(req));
  }

  async sendTwoFactorEmail(token: string) {
    assertClientAreaEnabled(this.configService);

    const payload = await this.verifyTwoFactorToken(token);

    if (payload.method !== 'email') {
      throw sessionInvalid('Invalid 2FA method');
    }

    const identity = await this.securityRepo.findOne({
      where: { tenantId: payload.tenantId, userId: payload.sub },
    });

    if (!identity || !(await this.isEligible(identity))) {
      throw sessionInvalid('Invalid 2FA context');
    }

    await this.credentials.sendEmailTwoFactorCode(
      identity,
      'login',
      this.getProductName(),
    );

    return { success: true };
  }

  async refresh(
    refreshToken: string,
  ): Promise<ClientAreaAuthenticatedResponse> {
    assertClientAreaEnabled(this.configService);

    // Only Client Area sessions: an Agency refresh token never matches here,
    // and the Agency refresh filters `surface='agency'` symmetrically.
    const session = await this.sessionsRepo.findOne({
      where: {
        sessionTokenHash: this.credentials.hashToken(refreshToken),
        surface: CLIENT_AREA_SURFACE,
      },
    });

    if (!session || !isLiveSession(session, new Date())) {
      if (session && !session.revokedAt) {
        await this.sessionsRepo.update(session.id, {
          status: 'expired',
          revokedAt: new Date(),
        });
      }
      throw sessionInvalid('Invalid refresh token');
    }

    const identity = await this.securityRepo.findOne({
      where: { tenantId: session.tenantId, userId: session.userId },
    });

    if (!identity || !(await this.isEligible(identity))) {
      // No identity, an Agency operator, or no active membership left: the
      // person has no business holding Client Area sessions anymore.
      await this.sessions.revokeAll(session.tenantId, session.userId);
      throw sessionInvalid('Invalid session context');
    }

    const newRefreshToken = randomBytes(48).toString('hex');
    await this.sessionsRepo.update(session.id, {
      sessionTokenHash: this.credentials.hashToken(newRefreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      lastSeen: new Date().toISOString(),
    });

    return {
      accessToken: await this.signAccessToken(identity, session.id),
      refreshToken: newRefreshToken,
      user: await this.buildUserResponse(identity),
    };
  }

  async logout(refreshToken: string) {
    // Logging out must work even with the gate off, so a person can always
    // end a session; it only ever touches Client Area sessions.
    const session = await this.sessionsRepo.findOne({
      where: {
        sessionTokenHash: this.credentials.hashToken(refreshToken),
        surface: CLIENT_AREA_SURFACE,
      },
    });

    if (session && !session.revokedAt) {
      await this.sessionsRepo.update(session.id, {
        status: 'expired',
        revokedAt: new Date(),
      });
      await this.credentials.recordLoginEvent(
        session.tenantId,
        session.userId,
        'logout',
        session,
        CLIENT_AREA_SURFACE,
      );
    }

    return { success: true };
  }

  async buildUserResponse(
    identity: Pick<
      AgencyUserSecuritySettingsEntity,
      'tenantId' | 'userId' | 'currentEmail'
    >,
  ): Promise<ClientAreaUserResponse> {
    const profile = await this.profilesRepo.findOne({
      where: { tenantId: identity.tenantId, userId: identity.userId },
    });

    return {
      id: identity.userId,
      email: identity.currentEmail,
      displayName: profile?.displayName?.trim() || identity.currentEmail,
    };
  }

  /**
   * Identities whose email matches (case-insensitive) and that may use the
   * Client Area: at least one active membership and no active Agency
   * membership in the same tenant. Agency eligibility is never consulted.
   */
  async findEligibleIdentities(email: string) {
    const normalized = normalizeClientAreaEmail(email);

    if (!normalized) {
      return [];
    }

    const candidates = await this.securityRepo
      .createQueryBuilder('identity')
      .where('LOWER(identity.current_email) = :email', { email: normalized })
      .getMany();

    const eligible: AgencyUserSecuritySettingsEntity[] = [];
    for (const identity of candidates) {
      if (await this.isEligible(identity)) {
        eligible.push(identity);
      }
    }

    return eligible;
  }

  async isEligible(identity: AgencyUserSecuritySettingsEntity) {
    const hasMembership = await this.management.hasIdentityAvailableCompany(identity);

    return (
      hasMembership &&
      !(await this.sessions.isAgencyOperator(
        identity.tenantId,
        identity.userId,
      ))
    );
  }

  private async createTwoFactorChallenge(
    identity: AgencyUserSecuritySettingsEntity,
  ): Promise<ClientAreaTwoFactorChallenge> {
    const method = this.credentials.getTwoFactorMethod(identity);

    if (method === 'email') {
      await this.credentials.sendEmailTwoFactorCode(
        identity,
        'login',
        this.getProductName(),
      );
    }

    const payload: ClientAreaTwoFactorTokenPayload = {
      sub: identity.userId,
      tenantId: identity.tenantId,
      typ: CLIENT_AREA_TWO_FACTOR_TOKEN_TYPE,
      method,
    };

    return {
      requiresTwoFactor: true,
      method,
      tempToken: await this.jwtService.signAsync(payload, {
        secret: this.getAccessSecret(),
        expiresIn: TWO_FACTOR_TOKEN_TTL,
        algorithm: 'HS256',
      }),
    };
  }

  /**
   * Opens a Client Area session for an identity that has just proven itself
   * (login, 2FA, or — CA2 — invitation acceptance). Callers are responsible
   * for eligibility.
   */
  async createAuthenticatedSession(
    identity: AgencyUserSecuritySettingsEntity,
    client: LoginRequestContext,
  ): Promise<ClientAreaAuthenticatedResponse> {
    const refreshToken = randomBytes(48).toString('hex');
    const session = await this.sessionsRepo.save(
      this.sessionsRepo.create({
        tenantId: identity.tenantId,
        userId: identity.userId,
        sessionTokenHash: this.credentials.hashToken(refreshToken),
        title: 'Area do Cliente',
        browser: client.deviceName,
        userAgent: client.userAgent,
        ipAddress: client.ipAddress,
        deviceFingerprint: client.deviceFingerprint,
        deviceName: client.deviceName,
        location: client.location ?? client.ipAddress,
        lastSeen: new Date().toISOString(),
        status: 'active',
        surface: CLIENT_AREA_SURFACE,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
        revokedAt: null,
      }),
    );

    await this.credentials.recordLoginEvent(
      identity.tenantId,
      identity.userId,
      'login_success',
      client,
      CLIENT_AREA_SURFACE,
    );

    return {
      accessToken: await this.signAccessToken(identity, session.id),
      refreshToken,
      user: await this.buildUserResponse(identity),
    };
  }

  private signAccessToken(
    identity: AgencyUserSecuritySettingsEntity,
    sessionId: string,
  ) {
    const payload: ClientAreaTokenPayload = {
      sub: identity.userId,
      tenantId: identity.tenantId,
      sessionId,
      typ: CLIENT_AREA_TOKEN_TYPE,
      email: identity.currentEmail,
    };

    return this.jwtService.signAsync(payload, {
      secret: this.getAccessSecret(),
      expiresIn: ACCESS_TOKEN_TTL,
      algorithm: 'HS256',
    });
  }

  private async verifyTwoFactorToken(
    token: string,
  ): Promise<ClientAreaTwoFactorTokenPayload> {
    try {
      const payload =
        await this.jwtService.verifyAsync<ClientAreaTwoFactorTokenPayload>(
          token,
          { secret: this.getAccessSecret(), algorithms: ['HS256'] },
        );

      if (
        payload.typ !== CLIENT_AREA_TWO_FACTOR_TOKEN_TYPE ||
        !payload.sub ||
        !payload.tenantId ||
        (payload.method !== 'email' && payload.method !== 'authenticator')
      ) {
        throw new Error('invalid_client_area_2fa_token');
      }

      return payload;
    } catch {
      throw sessionInvalid('Invalid 2FA token');
    }
  }

  getAccessSecret() {
    const secret = resolveClientAreaAccessSecret(this.configService);

    if (!secret) {
      // Unreachable behind assertClientAreaEnabled; kept fail-closed anyway.
      throw sessionInvalid();
    }

    return secret;
  }

  getProductName() {
    return (
      this.configService.get<string>('CLIENT_AREA_PRODUCT_NAME') ??
      'Area do Cliente'
    );
  }
}
