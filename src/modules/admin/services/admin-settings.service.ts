import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomInt } from 'crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { MoreThan, Not, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import type { LoginRequestContext } from '../../auth/utils/login-context.util';
import { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import { EmailService } from '../../email/email.service';
import { renderTransactionalEmail } from '../../email/templates/transactional-email.template';
import { AdminIdentityGateway } from '../contracts/admin-identity.gateway';
import type {
  BeginAdminTwoFactorSetupDto,
  ChangeAdminPasswordDto,
  ConfirmAdminTwoFactorSetupDto,
  UpdateAdminPreferencesDto,
  UpdateAdminProfileDto,
} from '../dto/admin-settings.dto';
import {
  PlatformAdminSessionEntity,
  PlatformAdminTwoFactorCodeEntity,
  PlatformInternalAdminEntity,
} from '../entities';
import type { AdminPrincipal } from '../types/admin-access.types';
import { AdminAuditService } from './admin-audit.service';

const AGENCY_CONNECTION = 'agency';
const GENERIC_PASSWORD_ERROR = 'Current password is invalid.';
const GENERIC_TWO_FACTOR_ERROR = 'Invalid administrative verification.';

@Injectable()
export class AdminSettingsService {
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
    private readonly auditService: AdminAuditService,
    private readonly cryptoService: SettingsCryptoService,
    private readonly emailService: EmailService,
  ) {}

  async getOverview(principal: AdminPrincipal) {
    const [profile, preferences, security, activeSessionsCount] =
      await Promise.all([
        this.getProfile(principal),
        this.getPreferences(principal),
        this.getSecurity(principal),
        this.sessionRepository.count({
          where: {
            adminId: principal.adminId,
            userId: principal.userId,
            identityTenantId: principal.identityTenantId,
            status: 'active',
            expiresAt: MoreThan(new Date()),
          },
        }),
      ]);
    return {
      profile,
      preferences,
      security,
      activeSessionsCount,
      currentSessionId: principal.sessionId,
    };
  }

  async getProfile(principal: AdminPrincipal) {
    const [identity, admin] = await Promise.all([
      this.requireIdentity(principal),
      this.requireAdmin(principal),
    ]);
    return {
      displayName: identity.displayName,
      email: identity.email,
      phone: identity.phone ?? null,
      jobTitle: identity.jobTitle ?? null,
      avatarUrl: identity.avatarUrl ?? null,
      roleKey: admin.roleKey,
      status: admin.status,
    };
  }

  async updateProfile(
    principal: AdminPrincipal,
    dto: UpdateAdminProfileDto,
    client: LoginRequestContext,
  ) {
    const identity = await this.identityGateway.updateProfile(
      principal.identityTenantId,
      principal.userId,
      {
        displayName: dto.displayName,
        phone: normalizeNullable(dto.phone),
        jobTitle: normalizeNullable(dto.jobTitle),
        avatarUrl: normalizeNullable(dto.avatarUrl),
      },
    );
    if (!identity) {
      throw new NotFoundException('Administrative profile was not found.');
    }
    await this.audit(principal, client, 'admin.settings.profile_updated', {
      fields: [
        'displayName',
        ...(dto.phone !== undefined ? ['phone'] : []),
        ...(dto.jobTitle !== undefined ? ['jobTitle'] : []),
        ...(dto.avatarUrl !== undefined ? ['avatarUrl'] : []),
      ],
    });
    return this.getProfile(principal);
  }

  async getPreferences(principal: AdminPrincipal) {
    const admin = await this.requireAdmin(principal);
    return {
      locale: admin.locale as 'pt-BR' | 'en-US',
      theme: admin.theme as 'light' | 'dark' | 'system',
      timezone: admin.timezone,
      dateFormat: admin.dateFormat,
      timeFormat: admin.timeFormat,
    };
  }

  async updatePreferences(
    principal: AdminPrincipal,
    dto: UpdateAdminPreferencesDto,
    client: LoginRequestContext,
  ) {
    if (!isValidTimeZone(dto.timezone)) {
      throw new BadRequestException('Invalid IANA timezone.');
    }
    const admin = await this.requireAdmin(principal);
    admin.locale = dto.locale;
    admin.theme = dto.theme;
    admin.timezone = dto.timezone;
    admin.dateFormat = dto.dateFormat;
    admin.timeFormat = dto.timeFormat;
    admin.updatedBy = principal.userId;
    await this.adminRepository.save(admin);
    await this.audit(principal, client, 'admin.settings.preferences_updated', {
      locale: dto.locale,
      theme: dto.theme,
      timezone: dto.timezone,
      dateFormat: dto.dateFormat,
      timeFormat: dto.timeFormat,
    });
    return this.getPreferences(principal);
  }

  async getSecurity(principal: AdminPrincipal) {
    const [admin, identity] = await Promise.all([
      this.requireAdmin(principal),
      this.requireIdentity(principal),
    ]);
    return {
      passwordConfigured: identity.passwordConfigured,
      twoFactorEnabled: identity.twoFactorEnabled,
      twoFactorMethod: identity.twoFactorMethod,
      twoFactorRequired: admin.twoFactorRequired,
    };
  }

  async changePassword(
    principal: AdminPrincipal,
    dto: ChangeAdminPasswordDto,
    client: LoginRequestContext,
  ) {
    const updated = await this.identityGateway.updatePassword(
      principal.identityTenantId,
      principal.userId,
      dto.currentPassword,
      dto.newPassword,
    );
    if (!updated) {
      throw new UnauthorizedException(GENERIC_PASSWORD_ERROR);
    }
    const revokedCount = await this.revokeOtherSessions(principal);
    await this.audit(principal, client, 'admin.settings.password_changed', {
      otherSessionsRevoked: revokedCount,
    });
    return { success: true, otherSessionsRevoked: revokedCount };
  }

  async beginTwoFactorSetup(
    principal: AdminPrincipal,
    dto: BeginAdminTwoFactorSetupDto,
  ) {
    await this.assertPassword(principal, dto.currentPassword);
    const [identity, security] = await Promise.all([
      this.requireIdentity(principal),
      this.requireSecurity(principal),
    ]);
    if (dto.method === 'email') {
      security.twoFactorPendingSecretEncrypted = null;
      await this.securityRepository.save(security);
      await this.sendEmailCode(principal, identity.email);
      return { method: 'email' as const, emailSent: true as const };
    }
    const secret = generateSecret();
    security.twoFactorPendingSecretEncrypted =
      this.cryptoService.encrypt(secret);
    await this.securityRepository.save(security);
    const otpauthUrl = generateURI({
      issuer: 'Lyra Admin',
      label: identity.email,
      secret,
    });
    return {
      method: 'authenticator' as const,
      qrCodeDataUrl: await QRCode.toDataURL(otpauthUrl),
    };
  }

  async confirmTwoFactorSetup(
    principal: AdminPrincipal,
    dto: ConfirmAdminTwoFactorSetupDto,
    client: LoginRequestContext,
  ) {
    const [identity, security] = await Promise.all([
      this.requireIdentity(principal),
      this.requireSecurity(principal),
    ]);
    const previousMethod = identity.twoFactorMethod;
    if (dto.method === 'email') {
      await this.verifyEmailCode(principal, dto.code);
      security.twoFactorEnabled = true;
      security.twoFactorMethod = 'email';
      security.twoFactorSecretEncrypted = null;
      security.twoFactorPendingSecretEncrypted = null;
    } else {
      const secret = this.safeDecrypt(security.twoFactorPendingSecretEncrypted);
      if (
        !secret ||
        !(await verify({ token: dto.code.trim(), secret })).valid
      ) {
        throw new UnauthorizedException(GENERIC_TWO_FACTOR_ERROR);
      }
      security.twoFactorEnabled = true;
      security.twoFactorMethod = 'authenticator';
      security.twoFactorSecretEncrypted =
        security.twoFactorPendingSecretEncrypted;
      security.twoFactorPendingSecretEncrypted = null;
    }
    await this.securityRepository.save(security);
    await this.audit(
      principal,
      client,
      'admin.settings.two_factor_method_changed',
      { previousMethod, method: dto.method, twoFactorEnabled: true },
    );
    return {
      success: true,
      twoFactorEnabled: true,
      twoFactorMethod: dto.method,
    };
  }

  async disableTwoFactor(
    principal: AdminPrincipal,
    currentPassword: string,
    client: LoginRequestContext,
  ) {
    await this.assertPassword(principal, currentPassword);
    const admin = await this.requireAdmin(principal);
    if (admin.twoFactorRequired) {
      await this.audit(
        principal,
        client,
        'admin.settings.two_factor_disable_denied',
        { reason: 'two_factor_required', twoFactorEnabled: true },
        'denied',
      );
      throw new ForbiddenException(
        'Two-factor authentication is required for this account.',
      );
    }
    const security = await this.requireSecurity(principal);
    security.twoFactorEnabled = false;
    security.twoFactorSecretEncrypted = null;
    security.twoFactorPendingSecretEncrypted = null;
    await this.securityRepository.save(security);
    await this.audit(
      principal,
      client,
      'admin.settings.two_factor_method_changed',
      { method: null, twoFactorEnabled: false },
    );
    return { success: true, twoFactorEnabled: false };
  }

  async getSessions(principal: AdminPrincipal) {
    const sessions = await this.sessionRepository.find({
      where: {
        adminId: principal.adminId,
        userId: principal.userId,
        identityTenantId: principal.identityTenantId,
      },
      order: { lastSeenAt: 'DESC' },
      take: 50,
    });
    return sessions.map((session) =>
      this.toSafeSession(session, principal.sessionId),
    );
  }

  async revokeSession(
    principal: AdminPrincipal,
    sessionId: string,
    client: LoginRequestContext,
  ) {
    const session = await this.sessionRepository.findOne({
      where: {
        id: sessionId,
        adminId: principal.adminId,
        userId: principal.userId,
        identityTenantId: principal.identityTenantId,
      },
    });
    if (!session) {
      throw new NotFoundException('Administrative session was not found.');
    }
    const revokedCurrentSession = session.id === principal.sessionId;
    if (session.status === 'active') {
      session.status = 'revoked';
      session.revokedAt = new Date();
      await this.sessionRepository.save(session);
    }
    await this.audit(
      principal,
      client,
      'admin.settings.session_revoked',
      { revokedCurrentSession },
      'success',
      'platform_admin_session',
      session.id,
    );
    return { success: true, revokedCurrentSession };
  }

  async revokeOtherSessionsWithAudit(
    principal: AdminPrincipal,
    client: LoginRequestContext,
  ) {
    const revokedCount = await this.revokeOtherSessions(principal);
    await this.audit(
      principal,
      client,
      'admin.settings.other_sessions_revoked',
      { revokedCount, currentSessionPreserved: true },
    );
    return { success: true, revokedCount };
  }

  private async revokeOtherSessions(
    principal: AdminPrincipal,
  ): Promise<number> {
    const sessions = await this.sessionRepository.find({
      where: {
        adminId: principal.adminId,
        userId: principal.userId,
        identityTenantId: principal.identityTenantId,
        status: 'active',
        id: Not(principal.sessionId),
      },
    });
    const now = new Date();
    for (const session of sessions) {
      session.status = 'revoked';
      session.revokedAt = now;
    }
    if (sessions.length > 0) {
      await this.sessionRepository.save(sessions);
    }
    return sessions.length;
  }

  private async requireAdmin(principal: AdminPrincipal) {
    const admin = await this.adminRepository.findOne({
      where: {
        id: principal.adminId,
        userId: principal.userId,
        identityTenantId: principal.identityTenantId,
      },
    });
    if (!admin) {
      throw new NotFoundException('Administrative account was not found.');
    }
    return admin;
  }

  private async requireIdentity(principal: AdminPrincipal) {
    const identity = await this.identityGateway.findByIdentity(
      principal.identityTenantId,
      principal.userId,
    );
    if (!identity || identity.status !== 'active') {
      throw new NotFoundException('Administrative identity was not found.');
    }
    return identity;
  }

  private async requireSecurity(principal: AdminPrincipal) {
    const security = await this.securityRepository.findOne({
      where: {
        tenantId: principal.identityTenantId,
        userId: principal.userId,
      },
    });
    if (!security) {
      throw new NotFoundException(
        'Administrative security state was not found.',
      );
    }
    return security;
  }

  private async assertPassword(principal: AdminPrincipal, password: string) {
    const valid = await this.identityGateway.verifyPassword(
      principal.identityTenantId,
      principal.userId,
      password,
    );
    if (!valid) {
      throw new UnauthorizedException(GENERIC_PASSWORD_ERROR);
    }
  }

  private toSafeSession(
    session: PlatformAdminSessionEntity,
    currentSessionId: string,
  ) {
    const status =
      session.status === 'active' && session.expiresAt.getTime() <= Date.now()
        ? 'expired'
        : session.status;
    return {
      id: session.id,
      title: session.title,
      browser: session.browser,
      deviceName: session.deviceName,
      ipAddress: session.ipAddress,
      location: session.location,
      lastSeenAt: session.lastSeenAt,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      isCurrent: session.id === currentSessionId,
      status,
    };
  }

  private async sendEmailCode(principal: AdminPrincipal, email: string) {
    const code = String(randomInt(100000, 1000000));
    await this.emailCodeRepository.save(
      this.emailCodeRepository.create({
        adminId: principal.adminId,
        identityTenantId: principal.identityTenantId,
        userId: principal.userId,
        codeHash: hashValue(code),
        purpose: 'admin_setup',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        usedAt: null,
        attempts: 0,
      }),
    );
    const { html, text } = renderTransactionalEmail({
      title: 'Verificação do Lyra Admin',
      intro: 'Use o código abaixo para alterar sua verificação em duas etapas.',
      secondaryText: `<strong>Código:</strong> ${code}`,
      footerText:
        'O código expira em 5 minutos. Ignore esta mensagem se você não solicitou a alteração.',
    });
    await this.emailService.sendEmail({
      to: email,
      subject: 'Código de segurança do Lyra Admin',
      html,
      text,
    });
  }

  private async verifyEmailCode(principal: AdminPrincipal, code: string) {
    const record = await this.emailCodeRepository.findOne({
      where: {
        adminId: principal.adminId,
        identityTenantId: principal.identityTenantId,
        userId: principal.userId,
        purpose: 'admin_setup',
      },
      order: { createdAt: 'DESC' },
    });
    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() <= Date.now() ||
      record.attempts >= 5 ||
      record.codeHash !== hashValue(code.trim())
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

  private safeDecrypt(value: string | null): string | null {
    try {
      return this.cryptoService.decrypt(value);
    } catch {
      return null;
    }
  }

  private audit(
    principal: AdminPrincipal,
    client: LoginRequestContext,
    action: string,
    metadata: Record<string, unknown>,
    outcome: 'success' | 'denied' | 'failure' = 'success',
    targetType = 'platform_admin',
    targetId = principal.adminId,
  ) {
    return this.auditService.record({
      actorAdminId: principal.adminId,
      actorUserId: principal.userId,
      action,
      targetType,
      targetId,
      outcome,
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      metadata,
    });
  }
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeNullable(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed || null;
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
