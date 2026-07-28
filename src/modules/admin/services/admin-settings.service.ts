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
import { type FindOptionsWhere, MoreThan, Not, Repository } from 'typeorm';
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
import {
  identityColumns,
  principalIdentityReference,
} from '../utils/admin-identity.util';
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
    private readonly legacySecurityRepository: Repository<AgencyUserSecuritySettingsEntity>,
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
    const reference = principalIdentityReference(principal);
    const profile = {
      displayName: dto.displayName,
      phone: normalizeNullable(dto.phone),
      jobTitle: normalizeNullable(dto.jobTitle),
      avatarUrl: normalizeNullable(dto.avatarUrl),
    };
    const gateway = this.identityGateway as AdminIdentityGateway & {
      findByIdentity?: unknown;
    };
    const identity =
      typeof gateway.findByReference === 'function'
        ? await gateway.updateProfile(reference, profile)
        : reference.source === 'agency'
          ? await (
              gateway.updateProfile as unknown as (
                tenantId: string,
                userId: string,
                value: typeof profile,
              ) => ReturnType<AdminIdentityGateway['updateProfile']>
            )(reference.tenantId, reference.userId, profile)
          : null;
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
    if (
      normalizeAdminPassword(dto.newPassword) ===
      normalizeAdminPassword(principal.email)
    ) {
      throw new BadRequestException(
        'Password does not meet the security policy.',
      );
    }
    const reference = principalIdentityReference(principal);
    const legacy = this.identityGateway as AdminIdentityGateway & {
      updatePassword?: (
        tenantId: string,
        userId: string,
        currentPassword: string,
        newPassword: string,
      ) => Promise<boolean>;
    };
    const updated =
      typeof legacy.changePassword === 'function'
        ? await legacy.changePassword(
            reference,
            dto.currentPassword,
            dto.newPassword,
          )
        : reference.source === 'agency' && legacy.updatePassword
          ? await legacy.updatePassword(
              reference.tenantId,
              reference.userId,
              dto.currentPassword,
              dto.newPassword,
            )
          : false;
    if (!updated) {
      throw new UnauthorizedException(GENERIC_PASSWORD_ERROR);
    }
    const revokedCount = await this.revokeOtherSessions(principal);
    await this.audit(principal, client, 'admin.settings.password_changed', {
      otherSessionsRevoked: revokedCount,
    });
    await this.audit(principal, client, 'admin.identity.password_changed', {
      identitySource: principal.identitySource ?? 'agency',
      identityId:
        principal.platformAdminIdentityId ?? principal.userId ?? undefined,
      otherSessionsRevoked: revokedCount,
    });
    return { success: true, otherSessionsRevoked: revokedCount };
  }

  async beginTwoFactorSetup(
    principal: AdminPrincipal,
    dto: BeginAdminTwoFactorSetupDto,
  ) {
    await this.assertPassword(principal, dto.currentPassword);
    const identity = await this.requireIdentity(principal);
    const reference = principalIdentityReference(principal);
    if (dto.method === 'email') {
      await this.setPendingTwoFactorSecret(reference, null);
      await this.sendEmailCode(principal, identity.email);
      return { method: 'email' as const, emailSent: true as const };
    }
    const secret = generateSecret();
    await this.setPendingTwoFactorSecret(
      reference,
      this.cryptoService.encrypt(secret),
    );
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
    const identity = await this.requireIdentity(principal);
    const reference = principalIdentityReference(principal);
    const previousMethod = identity.twoFactorMethod;
    if (dto.method === 'email') {
      await this.verifyEmailCode(principal, dto.code);
      await this.activateTwoFactor(reference, 'email', null);
    } else {
      const material = await this.getSecurityMaterial(reference);
      const secret = this.safeDecrypt(
        material?.twoFactorPendingSecretEncrypted ?? null,
      );
      if (
        !secret ||
        !(await verify({ token: dto.code.trim(), secret })).valid
      ) {
        throw new UnauthorizedException(GENERIC_TWO_FACTOR_ERROR);
      }
      await this.activateTwoFactor(
        reference,
        'authenticator',
        material?.twoFactorPendingSecretEncrypted ?? null,
      );
    }
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
    if (!(await this.clearTwoFactor(principalIdentityReference(principal)))) {
      throw new ForbiddenException(
        'Two-factor authentication cannot be changed through this identity source.',
      );
    }
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
        ...identityColumns(principalIdentityReference(principal)),
      } as unknown as FindOptionsWhere<PlatformAdminSessionEntity>,
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
        ...identityColumns(principalIdentityReference(principal)),
      } as unknown as FindOptionsWhere<PlatformAdminSessionEntity>,
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
        ...identityColumns(principalIdentityReference(principal)),
        status: 'active',
        id: Not(principal.sessionId),
      } as unknown as FindOptionsWhere<PlatformAdminSessionEntity>,
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
        ...identityColumns(principalIdentityReference(principal)),
      } as unknown as FindOptionsWhere<PlatformInternalAdminEntity>,
    });
    if (!admin) {
      throw new NotFoundException('Administrative account was not found.');
    }
    return admin;
  }

  private async requireIdentity(principal: AdminPrincipal) {
    const reference = principalIdentityReference(principal);
    const legacyGateway = this.identityGateway as AdminIdentityGateway & {
      findByIdentity?: (
        tenantId: string,
        userId: string,
      ) => ReturnType<AdminIdentityGateway['findByReference']>;
    };
    const identity =
      typeof legacyGateway.findByReference === 'function'
        ? await legacyGateway.findByReference(reference)
        : reference.source === 'agency' && legacyGateway.findByIdentity
          ? await legacyGateway.findByIdentity(
              reference.tenantId,
              reference.userId,
            )
          : null;
    if (!identity || identity.status !== 'active') {
      throw new NotFoundException('Administrative identity was not found.');
    }
    return identity;
  }

  private async assertPassword(principal: AdminPrincipal, password: string) {
    const reference = principalIdentityReference(principal);
    const gateway = this.identityGateway as AdminIdentityGateway & {
      findByIdentity?: unknown;
    };
    const valid =
      typeof gateway.findByReference === 'function'
        ? await gateway.verifyPassword(reference, password)
        : reference.source === 'agency'
          ? await (
              gateway.verifyPassword as unknown as (
                tenantId: string,
                userId: string,
                value: string,
              ) => Promise<boolean>
            )(reference.tenantId, reference.userId, password)
          : false;
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
        ...identityColumns(principalIdentityReference(principal)),
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

  private async getSecurityMaterial(
    reference: ReturnType<typeof principalIdentityReference>,
  ) {
    if (typeof this.identityGateway.getSecurityMaterial === 'function') {
      return this.identityGateway.getSecurityMaterial(reference);
    }
    if (reference.source !== 'agency') return null;
    const security = await this.legacySecurityRepository.findOne({
      where: { tenantId: reference.tenantId, userId: reference.userId },
    });
    return security
      ? {
          twoFactorSecretEncrypted: security.twoFactorSecretEncrypted,
          twoFactorPendingSecretEncrypted:
            security.twoFactorPendingSecretEncrypted,
        }
      : null;
  }

  private async setPendingTwoFactorSecret(
    reference: ReturnType<typeof principalIdentityReference>,
    value: string | null,
  ) {
    if (typeof this.identityGateway.setPendingTwoFactorSecret === 'function') {
      return this.identityGateway.setPendingTwoFactorSecret(reference, value);
    }
    if (reference.source !== 'agency') return false;
    const security = await this.legacySecurityRepository.findOne({
      where: { tenantId: reference.tenantId, userId: reference.userId },
    });
    if (!security) return false;
    security.twoFactorPendingSecretEncrypted = value;
    await this.legacySecurityRepository.save(security);
    return true;
  }

  private async activateTwoFactor(
    reference: ReturnType<typeof principalIdentityReference>,
    method: 'authenticator' | 'email',
    encryptedSecret: string | null,
  ) {
    if (typeof this.identityGateway.activateTwoFactor === 'function') {
      return this.identityGateway.activateTwoFactor(
        reference,
        method,
        encryptedSecret,
      );
    }
    if (reference.source !== 'agency') return false;
    const security = await this.legacySecurityRepository.findOne({
      where: { tenantId: reference.tenantId, userId: reference.userId },
    });
    if (!security) return false;
    security.twoFactorEnabled = true;
    security.twoFactorMethod = method;
    security.twoFactorSecretEncrypted =
      method === 'authenticator' ? encryptedSecret : null;
    security.twoFactorPendingSecretEncrypted = null;
    await this.legacySecurityRepository.save(security);
    return true;
  }

  private async clearTwoFactor(
    reference: ReturnType<typeof principalIdentityReference>,
  ) {
    if (typeof this.identityGateway.clearTwoFactor === 'function') {
      return this.identityGateway.clearTwoFactor(reference);
    }
    if (reference.source !== 'agency') return false;
    const security = await this.legacySecurityRepository.findOne({
      where: { tenantId: reference.tenantId, userId: reference.userId },
    });
    if (!security) return false;
    security.twoFactorEnabled = false;
    security.twoFactorMethod = 'authenticator';
    security.twoFactorSecretEncrypted = null;
    security.twoFactorPendingSecretEncrypted = null;
    await this.legacySecurityRepository.save(security);
    return true;
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

function normalizeAdminPassword(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
