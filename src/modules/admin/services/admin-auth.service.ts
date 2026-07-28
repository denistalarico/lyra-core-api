import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomInt } from 'crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import type { LoginRequestContext } from '../../auth/utils/login-context.util';
import { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import { EmailService } from '../../email/email.service';
import { renderTransactionalEmail } from '../../email/templates/transactional-email.template';
import { AdminIdentityGateway } from '../contracts/admin-identity.gateway';
import {
  PlatformAdminSessionEntity,
  PlatformAdminTwoFactorCodeEntity,
  PlatformInternalAdminEntity,
} from '../entities';
import type {
  AdminAuthTokenPayload,
  AdminPrincipal,
  AdminTwoFactorMethod,
  AdminTwoFactorTokenPayload,
} from '../types/admin-access.types';
import {
  isPlatformAdminRoleKey,
  PLATFORM_ADMIN_ROLE_PERMISSIONS,
} from '../types/admin-access.types';
import { normalizeAdminEmail } from '../utils/admin-identity.util';
import { AdminAccessService } from './admin-access.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuthTokenService } from './admin-auth-token.service';

const AGENCY_CONNECTION = 'agency';
const GENERIC_AUTH_ERROR = 'Invalid administrative credentials.';
const GENERIC_TWO_FACTOR_ERROR = 'Invalid administrative verification context.';

type AdminLoginContext = {
  admin: PlatformInternalAdminEntity;
  identity: {
    tenantId: string;
    userId: string;
    email: string;
    displayName: string;
    twoFactorEnabled: boolean;
    twoFactorMethod: AdminTwoFactorMethod;
  };
};

export type AdminAuthenticatedSessionResult = {
  accessToken: string;
  refreshToken: string;
  user: Awaited<ReturnType<AdminAuthService['getMe']>>;
};

@Injectable()
export class AdminAuthService {
  constructor(
    @InjectRepository(PlatformInternalAdminEntity, AGENCY_CONNECTION)
    private readonly adminRepository: Repository<PlatformInternalAdminEntity>,
    @InjectRepository(PlatformAdminSessionEntity, AGENCY_CONNECTION)
    private readonly sessionRepository: Repository<PlatformAdminSessionEntity>,
    @InjectRepository(AgencyUserSecuritySettingsEntity, AGENCY_CONNECTION)
    private readonly securityRepository: Repository<AgencyUserSecuritySettingsEntity>,
    @InjectRepository(PlatformAdminTwoFactorCodeEntity, AGENCY_CONNECTION)
    private readonly emailCodeRepository: Repository<PlatformAdminTwoFactorCodeEntity>,
    private readonly identityGateway: AdminIdentityGateway,
    private readonly accessService: AdminAccessService,
    private readonly auditService: AdminAuditService,
    private readonly tokenService: AdminAuthTokenService,
    private readonly cryptoService: SettingsCryptoService,
    private readonly emailService: EmailService,
  ) {}

  async login(
    emailInput: string,
    password: string,
    client: LoginRequestContext,
  ): Promise<
    | AdminAuthenticatedSessionResult
    | {
        requiresTwoFactor: true;
        method: AdminTwoFactorMethod;
        tempToken: string;
      }
    | {
        requiresTwoFactorSetup: true;
        availableMethods: readonly AdminTwoFactorMethod[];
        tempToken: string;
      }
  > {
    const email = normalizeAdminEmail(emailInput);
    const candidates = await this.identityGateway.findCandidatesByEmail(email);

    if (candidates.length !== 1) {
      await this.auditDenied('admin.auth.login_failed', client, {
        reason:
          candidates.length > 1 ? 'ambiguous_identity' : 'invalid_credentials',
      });
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    const identity = candidates[0];
    const passwordValid = await this.identityGateway.verifyPassword(
      identity.tenantId,
      identity.userId,
      password,
    );
    const admin = await this.adminRepository.findOne({
      where: {
        identityTenantId: identity.tenantId,
        userId: identity.userId,
      },
    });

    if (
      identity.status !== 'active' ||
      !passwordValid ||
      !admin ||
      admin.status !== 'active' ||
      !isPlatformAdminRoleKey(admin.roleKey) ||
      !PLATFORM_ADMIN_ROLE_PERMISSIONS[admin.roleKey].includes('admin.access')
    ) {
      await this.auditDenied(
        'admin.auth.login_failed',
        client,
        {
          reason: 'invalid_credentials_or_access',
        },
        admin,
      );
      throw new UnauthorizedException(GENERIC_AUTH_ERROR);
    }

    const context: AdminLoginContext = { admin, identity };
    if (admin.twoFactorRequired && !identity.twoFactorEnabled) {
      const tempToken = await this.tokenService.signTwoFactorToken(
        this.buildTwoFactorPayload(context, 'setup'),
      );
      await this.auditService.record({
        actorAdminId: admin.id,
        actorUserId: identity.userId,
        action: 'admin.auth.two_factor_setup_required',
        targetType: 'platform_admin',
        targetId: admin.id,
        outcome: 'success',
        ipAddress: client.ipAddress,
        userAgent: client.userAgent,
        metadata: { availableMethods: ['authenticator', 'email'] },
      });
      return {
        requiresTwoFactorSetup: true,
        availableMethods: ['authenticator', 'email'],
        tempToken,
      };
    }

    if (identity.twoFactorEnabled) {
      const method = identity.twoFactorMethod;
      const tempToken = await this.tokenService.signTwoFactorToken(
        this.buildTwoFactorPayload(context, 'login', method),
      );
      if (method === 'email') {
        await this.sendEmailCode(context, 'admin_login');
      }
      await this.auditService.record({
        actorAdminId: admin.id,
        actorUserId: identity.userId,
        action: 'admin.auth.two_factor_challenged',
        targetType: 'platform_admin',
        targetId: admin.id,
        outcome: 'success',
        ipAddress: client.ipAddress,
        userAgent: client.userAgent,
        metadata: { method },
      });
      return { requiresTwoFactor: true, method, tempToken };
    }

    return this.createAuthenticatedSession(context, client);
  }

  async loginWithTwoFactor(
    tempToken: string,
    code: string,
    client: LoginRequestContext,
  ): Promise<AdminAuthenticatedSessionResult> {
    let payload: AdminTwoFactorTokenPayload;
    let context: AdminLoginContext;
    try {
      payload = await this.tokenService.verifyTwoFactorToken(
        tempToken,
        'login',
      );
      context = await this.loadEligibleContext(payload);
      await this.verifyConfiguredTwoFactor(context, payload, code);
    } catch (error) {
      await this.auditDenied('admin.auth.two_factor_failed', client, {
        reason: 'invalid_verification',
      });
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException(GENERIC_TWO_FACTOR_ERROR);
    }

    await this.auditService.record({
      actorAdminId: context.admin.id,
      actorUserId: context.identity.userId,
      action: 'admin.auth.two_factor_succeeded',
      targetType: 'platform_admin',
      targetId: context.admin.id,
      outcome: 'success',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: { method: payload.method },
    });
    return this.createAuthenticatedSession(context, client);
  }

  async sendLoginEmailCode(tempToken: string): Promise<{ success: true }> {
    const payload = await this.tokenService.verifyTwoFactorToken(
      tempToken,
      'login',
    );
    if (payload.method !== 'email') {
      throw new UnauthorizedException(GENERIC_TWO_FACTOR_ERROR);
    }

    const context = await this.loadEligibleContext(payload);
    await this.sendEmailCode(context, 'admin_login');
    return { success: true };
  }

  async beginTwoFactorSetup(
    tempToken: string,
    method: AdminTwoFactorMethod,
  ): Promise<
    | {
        method: 'authenticator';
        otpauthUrl: string;
        qrCodeDataUrl: string;
      }
    | { method: 'email'; emailSent: true }
  > {
    const payload = await this.tokenService.verifyTwoFactorToken(
      tempToken,
      'setup',
    );
    const context = await this.loadEligibleContext(payload);
    this.assertSetupStillRequired(context);
    const security = await this.loadSecurity(context);

    if (method === 'email') {
      security.twoFactorPendingSecretEncrypted = null;
      await this.securityRepository.save(security);
      await this.sendEmailCode(context, 'admin_setup');
      return { method, emailSent: true };
    }

    const secret = generateSecret();
    security.twoFactorPendingSecretEncrypted =
      this.cryptoService.encrypt(secret);
    await this.securityRepository.save(security);

    const otpauthUrl = generateURI({
      issuer: 'Lyra Admin',
      label: context.identity.email,
      secret,
    });
    return {
      method,
      otpauthUrl,
      qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl),
    };
  }

  async confirmTwoFactorSetup(
    tempToken: string,
    method: AdminTwoFactorMethod,
    code: string,
    client: LoginRequestContext,
  ): Promise<AdminAuthenticatedSessionResult> {
    let context: AdminLoginContext;
    let security: AgencyUserSecuritySettingsEntity;
    try {
      const payload = await this.tokenService.verifyTwoFactorToken(
        tempToken,
        'setup',
      );
      context = await this.loadEligibleContext(payload);
      this.assertSetupStillRequired(context);
      security = await this.loadSecurity(context);

      if (method === 'email') {
        await this.verifyEmailCode(context, 'admin_setup', code);
        security.twoFactorEnabled = true;
        security.twoFactorMethod = 'email';
        security.twoFactorSecretEncrypted = null;
        security.twoFactorPendingSecretEncrypted = null;
      } else {
        const secret = this.safeDecrypt(
          security.twoFactorPendingSecretEncrypted,
        );
        if (!secret || !(await this.verifyAuthenticator(secret, code))) {
          throw new UnauthorizedException(GENERIC_TWO_FACTOR_ERROR);
        }
        security.twoFactorEnabled = true;
        security.twoFactorMethod = 'authenticator';
        security.twoFactorSecretEncrypted =
          security.twoFactorPendingSecretEncrypted;
        security.twoFactorPendingSecretEncrypted = null;
      }

      await this.securityRepository.save(security);
    } catch (error) {
      await this.auditDenied('admin.auth.two_factor_failed', client, {
        reason: 'invalid_setup_confirmation',
      });
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException(GENERIC_TWO_FACTOR_ERROR);
    }

    await this.auditService.record({
      actorAdminId: context.admin.id,
      actorUserId: context.identity.userId,
      action: 'admin.auth.two_factor_succeeded',
      targetType: 'platform_admin',
      targetId: context.admin.id,
      outcome: 'success',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: { method, flow: 'setup', twoFactorEnabled: true },
    });
    return this.createAuthenticatedSession(
      {
        admin: context.admin,
        identity: {
          ...context.identity,
          twoFactorEnabled: true,
          twoFactorMethod: method,
        },
      },
      client,
    );
  }

  async refresh(
    refreshToken: string,
    client: LoginRequestContext,
  ): Promise<AdminAuthenticatedSessionResult> {
    const refreshTokenHash = this.hashToken(refreshToken);
    const session = await this.sessionRepository.findOne({
      where: [
        { refreshTokenHash },
        { previousRefreshTokenHash: refreshTokenHash },
      ],
    });

    if (!session) {
      throw new UnauthorizedException('Invalid administrative session.');
    }

    if (session.previousRefreshTokenHash === refreshTokenHash) {
      await this.revokeSession(session, client, 'refresh_token_reuse');
      throw new UnauthorizedException('Invalid administrative session.');
    }

    if (
      session.status !== 'active' ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      if (session.status === 'active') {
        session.status = 'expired';
        session.revokedAt = new Date();
        await this.sessionRepository.save(session);
      }
      throw new UnauthorizedException('Invalid administrative session.');
    }

    let context: AdminLoginContext;
    try {
      context = await this.loadEligibleContextByIdentity(
        session.adminId,
        session.userId,
        session.identityTenantId,
      );
    } catch (error) {
      await this.revokeSession(session, client, 'admin_access_invalidated');
      throw error;
    }
    if (context.admin.twoFactorRequired && !context.identity.twoFactorEnabled) {
      await this.revokeSession(session, client, 'two_factor_policy_not_met');
      throw new UnauthorizedException('Invalid administrative session.');
    }
    const nextRefreshToken = this.createRefreshToken();
    const nextRefreshTokenHash = this.hashToken(nextRefreshToken);
    const nextExpiresAt = new Date(
      Date.now() + this.tokenService.getRefreshTokenTtlMs(),
    );
    const updateResult = await this.sessionRepository.update(
      {
        id: session.id,
        refreshTokenHash,
        status: 'active',
      },
      {
        previousRefreshTokenHash: refreshTokenHash,
        refreshTokenHash: nextRefreshTokenHash,
        lastSeenAt: new Date(),
        expiresAt: nextExpiresAt,
      },
    );

    if (updateResult.affected !== 1) {
      await this.revokeSession(session, client, 'refresh_rotation_conflict');
      throw new UnauthorizedException('Invalid administrative session.');
    }

    const principal = await this.requirePrincipal(context.admin.id, session.id);
    await this.auditService.record({
      actorAdminId: context.admin.id,
      actorUserId: context.identity.userId,
      action: 'admin.auth.session_refreshed',
      targetType: 'platform_admin_session',
      targetId: session.id,
      outcome: 'success',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: { result: 'rotated' },
    });

    return {
      accessToken: await this.tokenService.signAccessToken(
        this.buildAccessPayload(principal),
      ),
      refreshToken: nextRefreshToken,
      user: await this.getMe(principal),
    };
  }

  async logout(
    refreshToken: string | null,
    client: LoginRequestContext,
  ): Promise<{ success: true }> {
    if (!refreshToken) {
      await this.auditService.record({
        action: 'admin.auth.logout',
        outcome: 'success',
        ipAddress: client.ipAddress,
        userAgent: client.userAgent,
        metadata: { result: 'session_not_found' },
      });
      return { success: true };
    }

    const session = await this.sessionRepository.findOne({
      where: { refreshTokenHash: this.hashToken(refreshToken) },
    });
    if (session && session.status === 'active') {
      await this.revokeSession(session, client, 'logout');
    }

    await this.auditService.record({
      actorAdminId: session?.adminId ?? null,
      actorUserId: session?.userId ?? null,
      action: 'admin.auth.logout',
      targetType: session ? 'platform_admin_session' : null,
      targetId: session?.id ?? null,
      outcome: 'success',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: { result: session ? 'revoked' : 'session_not_found' },
    });
    return { success: true };
  }

  async authenticateAccessToken(
    payload: AdminAuthTokenPayload,
  ): Promise<AdminPrincipal> {
    const session = await this.sessionRepository.findOne({
      where: { id: payload.sessionId },
    });
    if (
      !session ||
      session.status !== 'active' ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.adminId !== payload.adminId ||
      session.userId !== payload.sub ||
      session.identityTenantId !== payload.identityTenantId
    ) {
      throw new UnauthorizedException('Invalid administrative session.');
    }

    let principal: AdminPrincipal;
    try {
      principal = await this.requirePrincipal(payload.adminId, session.id);
    } catch (error) {
      await this.revokeSession(
        session,
        this.clientContextFromSession(session),
        'admin_access_invalidated',
      );
      throw error;
    }
    if (
      principal.email !== payload.email ||
      principal.roleKey !== payload.roleKey ||
      principal.sessionContext !== 'admin'
    ) {
      throw new UnauthorizedException('Invalid administrative session.');
    }

    return principal;
  }

  async getMe(principal: AdminPrincipal) {
    const [admin, security] = await Promise.all([
      this.adminRepository.findOne({ where: { id: principal.adminId } }),
      this.securityRepository.findOne({
        where: {
          tenantId: principal.identityTenantId,
          userId: principal.userId,
        },
      }),
    ]);
    if (!admin || !security) {
      throw new UnauthorizedException('Invalid administrative session.');
    }

    return {
      adminId: principal.adminId,
      userId: principal.userId,
      email: principal.email,
      displayName: principal.displayName,
      roleKey: principal.roleKey,
      permissions: principal.permissions,
      twoFactorEnabled:
        security.twoFactorEnabled || Boolean(security.twoFactorSecretEncrypted),
      twoFactorMethod:
        security.twoFactorMethod === 'email' ? 'email' : 'authenticator',
      locale: admin.locale,
      theme: admin.theme,
      timezone: admin.timezone,
      sessionId: principal.sessionId,
    };
  }

  private async createAuthenticatedSession(
    context: AdminLoginContext,
    client: LoginRequestContext,
  ): Promise<AdminAuthenticatedSessionResult> {
    const refreshToken = this.createRefreshToken();
    const now = new Date();
    const session = await this.sessionRepository.save(
      this.sessionRepository.create({
        adminId: context.admin.id,
        userId: context.identity.userId,
        identityTenantId: context.identity.tenantId,
        refreshTokenHash: this.hashToken(refreshToken),
        previousRefreshTokenHash: null,
        status: 'active',
        title: 'Sessão administrativa',
        browser: client.deviceName,
        userAgent: client.userAgent || null,
        acceptLanguage: client.acceptLanguage || null,
        ipAddress: client.ipAddress || null,
        deviceFingerprint: client.deviceFingerprint || null,
        deviceName: client.deviceName || null,
        location: client.location,
        lastSeenAt: now,
        expiresAt: new Date(
          now.getTime() + this.tokenService.getRefreshTokenTtlMs(),
        ),
        revokedAt: null,
      }),
    );

    context.admin.lastAdminLoginAt = now;
    await this.adminRepository.save(context.admin);
    const principal = await this.requirePrincipal(context.admin.id, session.id);
    await this.auditService.record({
      actorAdminId: context.admin.id,
      actorUserId: context.identity.userId,
      action: 'admin.auth.login_succeeded',
      targetType: 'platform_admin_session',
      targetId: session.id,
      outcome: 'success',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: {
        roleKey: context.admin.roleKey,
        twoFactorEnabled: context.identity.twoFactorEnabled,
      },
    });

    return {
      accessToken: await this.tokenService.signAccessToken(
        this.buildAccessPayload(principal),
      ),
      refreshToken,
      user: await this.getMe(principal),
    };
  }

  private buildAccessPayload(principal: AdminPrincipal): AdminAuthTokenPayload {
    return {
      sub: principal.userId,
      adminId: principal.adminId,
      identityTenantId: principal.identityTenantId,
      sessionId: principal.sessionId,
      email: principal.email,
      roleKey: principal.roleKey,
      sessionContext: 'admin',
    };
  }

  private buildTwoFactorPayload(
    context: AdminLoginContext,
    flow: AdminTwoFactorTokenPayload['flow'],
    method?: AdminTwoFactorMethod,
  ): AdminTwoFactorTokenPayload {
    return {
      sub: context.identity.userId,
      adminId: context.admin.id,
      identityTenantId: context.identity.tenantId,
      email: context.identity.email,
      roleKey: context.admin.roleKey,
      flow,
      method,
      sessionContext: 'admin-2fa',
    };
  }

  private async loadEligibleContext(
    payload: AdminTwoFactorTokenPayload,
  ): Promise<AdminLoginContext> {
    const context = await this.loadEligibleContextByIdentity(
      payload.adminId,
      payload.sub,
      payload.identityTenantId,
    );
    if (
      payload.email !== context.identity.email ||
      payload.roleKey !== context.admin.roleKey
    ) {
      throw new UnauthorizedException(GENERIC_TWO_FACTOR_ERROR);
    }
    return context;
  }

  private async loadEligibleContextByIdentity(
    adminId: string,
    userId: string,
    identityTenantId: string,
  ): Promise<AdminLoginContext> {
    const admin = await this.adminRepository.findOne({
      where: { id: adminId },
    });
    if (
      !admin ||
      admin.status !== 'active' ||
      admin.userId !== userId ||
      admin.identityTenantId !== identityTenantId ||
      !isPlatformAdminRoleKey(admin.roleKey) ||
      !PLATFORM_ADMIN_ROLE_PERMISSIONS[admin.roleKey].includes('admin.access')
    ) {
      throw new UnauthorizedException(GENERIC_TWO_FACTOR_ERROR);
    }

    const identity = await this.identityGateway.findByIdentity(
      admin.identityTenantId,
      admin.userId,
    );
    if (!identity || identity.status !== 'active') {
      throw new UnauthorizedException(GENERIC_TWO_FACTOR_ERROR);
    }

    return { admin, identity };
  }

  private async loadSecurity(
    context: AdminLoginContext,
  ): Promise<AgencyUserSecuritySettingsEntity> {
    const security = await this.securityRepository.findOne({
      where: {
        tenantId: context.identity.tenantId,
        userId: context.identity.userId,
      },
    });
    if (!security) {
      throw new UnauthorizedException(GENERIC_TWO_FACTOR_ERROR);
    }
    return security;
  }

  private async verifyConfiguredTwoFactor(
    context: AdminLoginContext,
    payload: AdminTwoFactorTokenPayload,
    code: string,
  ): Promise<void> {
    if (
      !context.identity.twoFactorEnabled ||
      !payload.method ||
      payload.method !== context.identity.twoFactorMethod
    ) {
      throw new UnauthorizedException(GENERIC_TWO_FACTOR_ERROR);
    }

    if (payload.method === 'email') {
      await this.verifyEmailCode(context, 'admin_login', code);
      return;
    }

    const security = await this.loadSecurity(context);
    const secret = this.safeDecrypt(security.twoFactorSecretEncrypted);
    if (!secret || !(await this.verifyAuthenticator(secret, code))) {
      throw new UnauthorizedException(GENERIC_TWO_FACTOR_ERROR);
    }
  }

  private async verifyEmailCode(
    context: AdminLoginContext,
    purpose: 'admin_login' | 'admin_setup',
    code: string,
  ): Promise<void> {
    const record = await this.emailCodeRepository.findOne({
      where: {
        adminId: context.admin.id,
        identityTenantId: context.identity.tenantId,
        userId: context.identity.userId,
        purpose,
      },
      order: { createdAt: 'DESC' },
    });
    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() <= Date.now() ||
      record.attempts >= 5 ||
      record.codeHash !== this.hashToken(code.trim())
    ) {
      if (record && !record.usedAt) {
        record.attempts += 1;
        await this.emailCodeRepository.save(record);
      }
      throw new UnauthorizedException(GENERIC_TWO_FACTOR_ERROR);
    }

    record.usedAt = new Date();
    await this.emailCodeRepository.save(record);
  }

  private async sendEmailCode(
    context: AdminLoginContext,
    purpose: 'admin_login' | 'admin_setup',
  ): Promise<void> {
    const code = String(randomInt(100000, 1000000));
    await this.emailCodeRepository.save(
      this.emailCodeRepository.create({
        adminId: context.admin.id,
        identityTenantId: context.identity.tenantId,
        userId: context.identity.userId,
        codeHash: this.hashToken(code),
        purpose,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        usedAt: null,
        attempts: 0,
      }),
    );

    const { html, text } = renderTransactionalEmail({
      title: 'Verificação do Lyra Admin',
      intro: 'Use o código abaixo para concluir seu acesso administrativo.',
      secondaryText: `<strong>Código:</strong> ${code}`,
      footerText:
        'O código expira em 5 minutos. Ignore esta mensagem se você não iniciou o acesso.',
    });
    await this.emailService.sendEmail({
      to: context.identity.email,
      subject: 'Código de verificação do Lyra Admin',
      html,
      text,
    });
  }

  private async requirePrincipal(
    adminId: string,
    sessionId: string,
  ): Promise<AdminPrincipal> {
    const principal = await this.accessService.resolvePrincipal(
      adminId,
      sessionId,
    );
    if (!principal) {
      throw new UnauthorizedException('Invalid administrative session.');
    }
    return principal;
  }

  private async revokeSession(
    session: PlatformAdminSessionEntity,
    client: LoginRequestContext,
    reason: string,
  ): Promise<void> {
    session.status = 'revoked';
    session.revokedAt = new Date();
    await this.sessionRepository.save(session);
    await this.auditService.record({
      actorAdminId: session.adminId,
      actorUserId: session.userId,
      action: 'admin.auth.session_revoked',
      targetType: 'platform_admin_session',
      targetId: session.id,
      outcome: 'success',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata: { reason },
    });
  }

  private async auditDenied(
    action: string,
    client: LoginRequestContext,
    metadata: Record<string, unknown>,
    admin?: PlatformInternalAdminEntity | null,
  ): Promise<void> {
    await this.auditService.record({
      actorAdminId: admin?.id ?? null,
      actorUserId: admin?.userId ?? null,
      action,
      targetType: admin ? 'platform_admin' : null,
      targetId: admin?.id ?? null,
      outcome: 'denied',
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata,
    });
  }

  private clientContextFromSession(
    session: PlatformAdminSessionEntity,
  ): LoginRequestContext {
    return {
      ipAddress: session.ipAddress ?? '',
      userAgent: session.userAgent ?? '',
      acceptLanguage: session.acceptLanguage ?? '',
      deviceFingerprint: session.deviceFingerprint ?? '',
      deviceName: session.deviceName ?? session.browser,
      location: session.location,
    };
  }

  private assertSetupStillRequired(context: AdminLoginContext): void {
    if (!context.admin.twoFactorRequired || context.identity.twoFactorEnabled) {
      throw new UnauthorizedException(GENERIC_TWO_FACTOR_ERROR);
    }
  }

  private safeDecrypt(value: string | null): string | null {
    try {
      return this.cryptoService.decrypt(value);
    } catch {
      return null;
    }
  }

  private async verifyAuthenticator(
    secret: string,
    code: string,
  ): Promise<boolean> {
    return (await verify({ token: code.trim(), secret })).valid;
  }

  private createRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  private hashToken(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
