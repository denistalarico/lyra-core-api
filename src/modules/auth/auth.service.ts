import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EmailService } from '../email/email.service';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { verify } from 'otplib';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AcceptWorkspaceInvitationDto } from './dto/accept-workspace-invitation.dto';
import { UserSecuritySettingsEntity } from '../settings/entities/user-security-settings.entity';
import { WorkspaceUserEntity } from '../settings/entities/workspace-user.entity';
import { WorkspaceUserModuleAccessEntity } from '../settings/entities/workspace-user-module-access.entity';
import {
  WorkspaceUserInvitationEntity,
  WorkspaceUserInvitationRole,
} from '../settings/entities/workspace-user-invitation.entity';
import { WorkspaceSettingsCompanyEntity } from '../settings/entities/workspace-settings-company.entity';
import { UserProfileEntity } from '../settings/entities/user-profile.entity';
import { UserSessionEntity } from '../settings/entities/user-session.entity';
import { UserTrustedDeviceEntity } from '../settings/entities/user-trusted-device.entity';
import { UserPreferencesEntity } from '../settings/entities/user-preferences.entity';
import { PasswordResetEntity } from './entities/password-reset.entity';
import { EmailTwoFactorCodeEntity } from './entities/email-2fa-code.entity';
import { AuthTokenPayload } from './types/auth-token-payload.type';
import { renderTransactionalEmail } from '../email/templates/transactional-email.template';
import {
  extractLoginContext,
  LoginRequestContext,
} from './utils/login-context.util';
import { AccessControlService } from '../../common/access-control/access-control.service';

type PasswordResetEmailLocale = 'pt-BR' | 'en' | 'es';
type TwoFactorMethod = 'authenticator' | 'email';
type EmailTwoFactorPurpose = 'login' | 'setup';
type WorkspaceRole = 'owner' | 'admin' | 'manager' | 'member';
type ModulePermission = 'admin' | 'manager' | 'member';
type JwtTokenExpiration = NonNullable<
  Parameters<JwtService['signAsync']>[1]
>['expiresIn'];
type LoginContext = {
  security: UserSecuritySettingsEntity;
  workspaceUser: WorkspaceUserEntity;
};
type LoginRiskFlags = {
  isNewDevice: boolean;
  isNewIp: boolean;
  isTrustedDevice: boolean;
  isSuspiciousLogin: boolean;
};
type TwoFactorTokenPayload = {
  sub: string;
  tenantId: string;
  type: '2fa';
  method: TwoFactorMethod;
};

const moduleKeys = [
  'inbox',
  'crm',
  'agents',
  'automations',
  'analytics',
  'social',
  'settings',
] as const;

function createModulesFromRole(role: WorkspaceRole) {
  if (role === 'owner') {
    return Object.fromEntries(
      moduleKeys.map((moduleKey) => [
        moduleKey,
        { enabled: true, permission: 'admin' as ModulePermission },
      ]),
    ) as Record<(typeof moduleKeys)[number], { enabled: boolean; permission: ModulePermission }>;
  }

  if (role === 'admin') {
    return {
      inbox: { enabled: true, permission: 'admin' as ModulePermission },
      crm: { enabled: true, permission: 'admin' as ModulePermission },
      agents: { enabled: true, permission: 'admin' as ModulePermission },
      automations: { enabled: true, permission: 'admin' as ModulePermission },
      analytics: { enabled: true, permission: 'manager' as ModulePermission },
      social: { enabled: true, permission: 'manager' as ModulePermission },
      settings: { enabled: true, permission: 'admin' as ModulePermission },
    };
  }

  if (role === 'manager') {
    return {
      inbox: { enabled: true, permission: 'manager' as ModulePermission },
      crm: { enabled: true, permission: 'manager' as ModulePermission },
      agents: { enabled: true, permission: 'manager' as ModulePermission },
      automations: { enabled: false, permission: 'member' as ModulePermission },
      analytics: { enabled: true, permission: 'member' as ModulePermission },
      social: { enabled: true, permission: 'manager' as ModulePermission },
      settings: { enabled: false, permission: 'member' as ModulePermission },
    };
  }

  return {
    inbox: { enabled: true, permission: 'member' as ModulePermission },
    crm: { enabled: true, permission: 'member' as ModulePermission },
    agents: { enabled: false, permission: 'member' as ModulePermission },
    automations: { enabled: false, permission: 'member' as ModulePermission },
    analytics: { enabled: true, permission: 'member' as ModulePermission },
    social: { enabled: true, permission: 'member' as ModulePermission },
    settings: { enabled: false, permission: 'member' as ModulePermission },
  };
}

function mapInvitationRoleToWorkspaceRole(
  role: WorkspaceUserInvitationRole,
): Exclude<WorkspaceRole, 'owner'> {
  return role === 'administrator' ? 'admin' : role;
}

type PasswordResetEmailCopy = {
  subject: string;
  title: string;
  intro: string;
  expiration: string;
};

const passwordResetEmailCopies: Record<
  PasswordResetEmailLocale,
  PasswordResetEmailCopy
> = {
  'pt-BR': {
    subject: 'Recuperação de senha',
    title: 'Recuperação de senha',
    intro: 'Clique no link abaixo para redefinir sua senha:',
    expiration: 'Este link expira em 15 minutos.',
  },
  en: {
    subject: 'Password recovery',
    title: 'Password recovery',
    intro: 'Click the link below to reset your password:',
    expiration: 'This link expires in 15 minutes.',
  },
  es: {
    subject: 'Recuperación de contraseña',
    title: 'Recuperación de contraseña',
    intro: 'Haz clic en el enlace de abajo para restablecer tu contraseña:',
    expiration: 'Este enlace vence en 15 minutos.',
  },
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserSecuritySettingsEntity)
    private readonly securityRepository: Repository<UserSecuritySettingsEntity>,

    @InjectRepository(WorkspaceUserEntity)
    private readonly workspaceUsersRepository: Repository<WorkspaceUserEntity>,

    @InjectRepository(WorkspaceUserModuleAccessEntity)
    private readonly workspaceUserModuleAccessRepository: Repository<WorkspaceUserModuleAccessEntity>,

    @InjectRepository(WorkspaceUserInvitationEntity)
    private readonly workspaceUserInvitationsRepository: Repository<WorkspaceUserInvitationEntity>,

    @InjectRepository(WorkspaceSettingsCompanyEntity)
    private readonly companyRepository: Repository<WorkspaceSettingsCompanyEntity>,

    @InjectRepository(UserProfileEntity)
    private readonly userProfileRepository: Repository<UserProfileEntity>,

    @InjectRepository(UserSessionEntity)
    private readonly sessionsRepository: Repository<UserSessionEntity>,

    @InjectRepository(UserTrustedDeviceEntity)
    private readonly trustedDevicesRepository: Repository<UserTrustedDeviceEntity>,

    @InjectRepository(PasswordResetEntity)
    private readonly passwordResetRepository: Repository<PasswordResetEntity>,

    @InjectRepository(EmailTwoFactorCodeEntity)
    private readonly emailTwoFactorRepository: Repository<EmailTwoFactorCodeEntity>,

    @InjectRepository(UserPreferencesEntity)
    private readonly userPreferencesRepository: Repository<UserPreferencesEntity>,

    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly cryptoService: SettingsCryptoService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async login(dto: LoginDto, req: Request) {
    const email = dto.email.trim().toLowerCase();

    const loginContext = await this.findLoginContext(email, dto.password);

    if (!loginContext) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (this.hasTwoFactorEnabled(loginContext.security)) {
      return this.createTwoFactorChallenge(loginContext.security);
    }

    return this.createAuthenticatedSession(
      loginContext,
      extractLoginContext(req),
    );
  }

  async refresh(dto: RefreshTokenDto) {
    const refreshTokenHash = this.hashToken(dto.refreshToken);

    const session = await this.sessionsRepository.findOne({
      where: {
        sessionTokenHash: refreshTokenHash,
      },
    });

    if (!session || session.revokedAt || session.status === 'expired') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
      session.status = 'expired';
      await this.sessionsRepository.save(session);
      throw new UnauthorizedException('Refresh token expired');
    }

    const security = await this.securityRepository.findOne({
      where: {
        tenantId: session.tenantId,
        userId: session.userId,
      },
    });

    const workspaceUser = await this.workspaceUsersRepository.findOne({
      where: {
        tenantId: session.tenantId,
        userId: session.userId,
        status: 'active',
      },
      order: { updatedAt: 'DESC' },
    });

    if (!security || !workspaceUser) {
      throw new UnauthorizedException('Invalid session context');
    }

    const newRefreshToken = this.createOpaqueRefreshToken();
    session.sessionTokenHash = this.hashToken(newRefreshToken);
    session.lastSeen = new Date().toISOString();
    session.expiresAt = this.getRefreshExpirationDate();
    await this.sessionsRepository.save(session);

    const payload: AuthTokenPayload = {
      sub: session.userId,
      tenantId: session.tenantId,
      workspaceId: workspaceUser.workspaceId,
      role: workspaceUser.role,
      sessionId: session.id,
      email: security.currentEmail,
    };
    const access = await this.accessControlService.getAccessContext(
      security.userId,
      security.tenantId,
      workspaceUser.workspaceId,
    );

    return {
      accessToken: await this.signAccessToken(payload),
      refreshToken: newRefreshToken,
      user: {
        ...payload,
        role: access.role,
        allowedModules: access.allowedModules,
        allowedSettingsSections: access.allowedSettingsSections,
      },
    };
  }

  async logout(refreshToken: string) {
    const session = await this.sessionsRepository.findOne({
      where: {
        sessionTokenHash: this.hashToken(refreshToken),
      },
    });

    if (session) {
      session.status = 'expired';
      session.revokedAt = new Date();
      await this.sessionsRepository.save(session);
    }

    return { success: true };
  }

  async loginWith2FA(token: string, code: string, req: Request) {
    const payload = await this.verifyTwoFactorToken(token);

    if (payload.method !== 'authenticator') {
      throw new UnauthorizedException('Invalid 2FA method');
    }

    const security = await this.securityRepository.findOne({
      where: {
        tenantId: payload.tenantId,
        userId: payload.sub,
      },
    });

    if (!security || !this.hasTwoFactorEnabled(security)) {
      throw new UnauthorizedException('2FA not configured');
    }

    const secret = this.cryptoService.decrypt(
      security.twoFactorSecretEncrypted,
    );

    if (!secret) {
      throw new UnauthorizedException('2FA not configured');
    }

    const verification = await verify({
      token: code,
      secret,
    });

    if (!verification.valid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    return this.createSessionAfter2FA(
      security.userId,
      security.tenantId,
      extractLoginContext(req),
    );
  }

  async getInvitationByToken(token: string) {
    const invitation = await this.findValidInvitationByToken(token);
    const [company, invitedByProfile, invitedByMembership] = await Promise.all([
      this.companyRepository.findOne({
        where: {
          tenantId: invitation.tenantId,
          workspaceId: invitation.workspaceId,
        },
      }),
      this.userProfileRepository.findOne({
        where: {
          tenantId: invitation.tenantId,
          userId: invitation.invitedByUserId,
        },
      }),
      this.workspaceUsersRepository.findOne({
        where: {
          tenantId: invitation.tenantId,
          workspaceId: invitation.workspaceId,
          userId: invitation.invitedByUserId,
        },
      }),
    ]);

    return {
      email: invitation.email,
      role: invitation.role,
      workspaceName:
        company?.publicName ||
        company?.workspaceName ||
        company?.legalName ||
        'Lyra Suite',
      invitedByName:
        invitedByProfile?.displayName ||
        [invitedByProfile?.firstName, invitedByProfile?.lastName]
          .filter(Boolean)
          .join(' ') ||
        invitedByMembership?.name ||
        null,
      expiresAt: invitation.expiresAt,
    };
  }

  async acceptInvitation(
    token: string,
    dto: AcceptWorkspaceInvitationDto,
  ) {
    if (dto.confirmPassword && dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match.');
    }

    const invitation = await this.findValidInvitationByToken(token);
    const normalizedEmail = invitation.email.trim().toLowerCase();

    const existingUser = await this.securityRepository
      .createQueryBuilder('security')
      .where('lower(security.currentEmail) = :email', {
        email: normalizedEmail,
      })
      .getOne();

    if (existingUser) {
      throw new ConflictException(
        'This email already has an account. Sign in to accept invitations.',
      );
    }

    const existingMembership = await this.workspaceUsersRepository
      .createQueryBuilder('workspaceUser')
      .where('workspaceUser.tenantId = :tenantId', {
        tenantId: invitation.tenantId,
      })
      .andWhere('workspaceUser.workspaceId = :workspaceId', {
        workspaceId: invitation.workspaceId,
      })
      .andWhere('lower(workspaceUser.email) = :email', {
        email: normalizedEmail,
      })
      .getOne();

    if (existingMembership) {
      throw new ConflictException(
        'This email already belongs to this workspace.',
      );
    }

    const userId = randomUUID();
    const displayName = dto.displayName.trim();
    const workspaceRole = mapInvitationRoleToWorkspaceRole(invitation.role);
    const modules = createModulesFromRole(workspaceRole);

    await this.securityRepository.manager.transaction(async (manager) => {
      const workspaceUser = await manager.save(
        WorkspaceUserEntity,
        manager.create(WorkspaceUserEntity, {
          tenantId: invitation.tenantId,
          workspaceId: invitation.workspaceId,
          userId,
          name: displayName,
          email: normalizedEmail,
          role: workspaceRole,
          status: 'active',
          lastAccess: 'Agora',
          invitedAt: invitation.createdAt,
          activatedAt: new Date(),
          deactivatedAt: null,
        }),
      );

      await manager.save(
        UserSecuritySettingsEntity,
        manager.create(UserSecuritySettingsEntity, {
          tenantId: invitation.tenantId,
          userId,
          currentEmail: normalizedEmail,
          passwordHash: await argon2.hash(dto.password),
          passwordUpdatedAt: new Date(),
          twoFactorEnabled: false,
          twoFactorMethod: 'authenticator',
          twoFactorSecretEncrypted: null,
          twoFactorPendingSecretEncrypted: null,
          loginAlertsEnabled: true,
          trustedDevicesEnabled: true,
        }),
      );

      await manager.save(
        UserProfileEntity,
        manager.create(UserProfileEntity, {
          tenantId: invitation.tenantId,
          userId,
          firstName: '',
          lastName: '',
          displayName,
          email: normalizedEmail,
          jobTitle: null,
          bio: null,
          avatarUrl: null,
          avatarAssetKey: null,
        }),
      );

      await manager.save(
        WorkspaceUserModuleAccessEntity,
        moduleKeys.map((moduleKey) =>
          manager.create(WorkspaceUserModuleAccessEntity, {
            tenantId: invitation.tenantId,
            workspaceId: invitation.workspaceId,
            workspaceUserId: workspaceUser.id,
            moduleKey,
            enabled: modules[moduleKey].enabled,
            permission: modules[moduleKey].permission,
          }),
        ),
      );

      invitation.status = 'accepted';
      invitation.acceptedAt = new Date();

      await manager.save(WorkspaceUserInvitationEntity, invitation);
    });

    return { success: true, email: normalizedEmail };
  }

  private async createTwoFactorChallenge(security: UserSecuritySettingsEntity) {
    const method = this.getTwoFactorMethod(security);

    if (method === 'email') {
      await this.sendEmailTwoFactorCode(
        security.tenantId,
        security.userId,
        security.currentEmail,
        'login',
      );
    }

    return {
      requiresTwoFactor: true,
      method,
      tempToken: await this.jwtService.signAsync<TwoFactorTokenPayload>(
        {
          sub: security.userId,
          tenantId: security.tenantId,
          type: '2fa',
          method,
        },
        {
          secret: this.getTwoFactorTokenSecret(),
          expiresIn: '5m',
        },
      ),
    };
  }

  private async createSessionAfter2FA(
    userId: string,
    tenantId: string,
    client: LoginRequestContext,
  ) {
    const security = await this.securityRepository.findOne({
      where: { tenantId, userId },
    });

    if (!security) {
      throw new UnauthorizedException('Invalid 2FA context');
    }

    const workspaceUser = await this.findActiveWorkspaceUser(security);

    if (!workspaceUser) {
      throw new UnauthorizedException('Invalid 2FA context');
    }

    return this.createAuthenticatedSession({ security, workspaceUser }, client);
  }

  private async createAuthenticatedSession(
    loginContext: LoginContext,
    client: LoginRequestContext,
  ) {
    const { security, workspaceUser } = loginContext;
    const refreshToken = this.createOpaqueRefreshToken();
    const refreshTokenHash = this.hashToken(refreshToken);
    const loginRisk = await this.getLoginRiskFlags(security, client);

    await this.sessionsRepository.update(
      {
        tenantId: security.tenantId,
        userId: security.userId,
        status: 'current',
      },
      {
        status: 'active',
      },
    );

    const session = await this.sessionsRepository.save(
      this.sessionsRepository.create({
        tenantId: security.tenantId,
        userId: security.userId,
        sessionTokenHash: refreshTokenHash,
        title: 'Sessão atual',
        browser: client.deviceName,
        userAgent: client.userAgent,
        acceptLanguage: client.acceptLanguage,
        ipAddress: client.ipAddress,
        deviceFingerprint: client.deviceFingerprint,
        deviceName: client.deviceName,
        location: client.location ?? client.ipAddress,
        lastSeen: new Date().toISOString(),
        status: 'current',
        expiresAt: this.getRefreshExpirationDate(),
        revokedAt: null,
      }),
    );

    const payload: AuthTokenPayload = {
      sub: security.userId,
      tenantId: security.tenantId,
      workspaceId: workspaceUser.workspaceId,
      role: workspaceUser.role,
      sessionId: session.id,
      email: security.currentEmail,
    };

    await this.sendNewLoginAlertIfNeeded(
      security,
      workspaceUser,
      client,
      loginRisk,
    );

    const access = await this.accessControlService.getAccessContext(
      security.userId,
      security.tenantId,
      workspaceUser.workspaceId,
    );

    return {
      accessToken: await this.signAccessToken(payload),
      refreshToken,
      user: {
        ...payload,
        role: access.role,
        allowedModules: access.allowedModules,
        allowedSettingsSections: access.allowedSettingsSections,
      },
      securityContext: {
        isTrustedDevice: loginRisk.isTrustedDevice,
        isNewDevice: loginRisk.isNewDevice,
        isSuspiciousLogin: loginRisk.isSuspiciousLogin,
      },
    };
  }

  private async getLoginRiskFlags(
    security: UserSecuritySettingsEntity,
    client: LoginRequestContext,
  ): Promise<LoginRiskFlags> {
    const trustedDevice = security.trustedDevicesEnabled
      ? await this.trustedDevicesRepository.findOne({
          where: {
            tenantId: security.tenantId,
            userId: security.userId,
            deviceFingerprint: client.deviceFingerprint,
            revokedAt: IsNull(),
          },
        })
      : null;

    const previousSessions = await this.sessionsRepository.find({
      where: {
        tenantId: security.tenantId,
        userId: security.userId,
      },
      order: { createdAt: 'DESC' },
      take: 20,
    });

    const isNewDevice = !previousSessions.some(
      (session) => session.deviceFingerprint === client.deviceFingerprint,
    );
    const isNewIp = !previousSessions.some(
      (session) => (session.ipAddress ?? session.location) === client.ipAddress,
    );
    const isTrustedDevice = Boolean(trustedDevice);
    const isTrustedDeviceIpAcceptable =
      isTrustedDevice &&
      (trustedDevice?.ipAddress === client.ipAddress || !isNewIp);

    if (trustedDevice) {
      await this.trustedDevicesRepository.update(
        { id: trustedDevice.id },
        { lastUsedAt: new Date() },
      );
    }

    return {
      isNewDevice: isTrustedDevice ? false : isNewDevice,
      isNewIp,
      isTrustedDevice,
      isSuspiciousLogin: isTrustedDeviceIpAcceptable
        ? false
        : (isTrustedDevice ? false : isNewDevice) || isNewIp,
    };
  }

  private async sendNewLoginAlertIfNeeded(
    security: UserSecuritySettingsEntity,
    workspaceUser: WorkspaceUserEntity,
    client: LoginRequestContext,
    loginRisk: LoginRiskFlags,
  ) {
    if (!security.loginAlertsEnabled || !loginRisk.isSuspiciousLogin) {
      return;
    }

    try {
      await this.emailService.sendNewLoginAlert({
        to: security.currentEmail,
        userName: workspaceUser.name,
        deviceName: client.deviceName,
        ipAddress: client.ipAddress,
        location: client.location,
        loginAt: new Date(),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send new login alert for user ${security.userId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async verifyTwoFactorToken(
    token: string,
  ): Promise<TwoFactorTokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<TwoFactorTokenPayload>(
        token,
        {
          secret: this.getTwoFactorTokenSecret(),
        },
      );

      if (
        payload.type !== '2fa' ||
        typeof payload.sub !== 'string' ||
        typeof payload.tenantId !== 'string' ||
        (payload.method !== 'authenticator' && payload.method !== 'email')
      ) {
        throw new UnauthorizedException('Invalid token');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private hasTwoFactorEnabled(security: UserSecuritySettingsEntity): boolean {
    if (!security.twoFactorEnabled) {
      return false;
    }

    const method = this.getTwoFactorMethod(security);

    if (method === 'email') {
      return Boolean(security.currentEmail);
    }

    return Boolean(security.twoFactorSecretEncrypted);
  }

  private getTwoFactorMethod(
    security: UserSecuritySettingsEntity,
  ): TwoFactorMethod {
    return security.twoFactorMethod === 'email' ? 'email' : 'authenticator';
  }

  private async signAccessToken(payload: AuthTokenPayload): Promise<string> {
    const expiresIn: JwtTokenExpiration =
      this.configService.get<JwtTokenExpiration>('JWT_ACCESS_EXPIRES_IN') ??
      '15m';

    return this.jwtService.signAsync(payload, {
      secret: this.getAccessTokenSecret(),
      expiresIn,
    });
  }

  private createOpaqueRefreshToken(): string {
    return randomBytes(48).toString('hex');
  }

  private getAccessTokenSecret(): string {
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');

    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }

    return secret;
  }

  private getTwoFactorTokenSecret(): string {
    return (
      this.configService.get<string>('JWT_2FA_SECRET') ??
      this.getAccessTokenSecret()
    );
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async findValidInvitationByToken(token: string) {
    const tokenHash = this.hashToken(token);
    const invitation = await this.workspaceUserInvitationsRepository.findOne({
      where: {
        tokenHash,
        status: 'pending',
        revokedAt: IsNull(),
        acceptedAt: IsNull(),
      },
      order: { createdAt: 'DESC' },
    });

    if (!invitation || invitation.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid or expired invitation');
    }

    return invitation;
  }

  private getRefreshExpirationDate(): Date {
    const expiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    const match = expiresIn.match(/^(\d+)d$/);
    const days = match ? Number(match[1]) : 7;

    const date = new Date();
    date.setDate(date.getDate() + days);

    return date;
  }

  async forgotPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();

    const security = await this.findSecurityForPasswordReset(normalizedEmail);

    if (!security) {
      return { success: true };
    }

    await this.sendPasswordResetEmail(security, normalizedEmail);

    return { success: true };
  }

  private async findLoginContext(email: string, password: string) {
    const securityRecords = await this.securityRepository.find({
      where: { currentEmail: email },
      order: { updatedAt: 'DESC' },
    });

    for (const security of securityRecords) {
      if (!security.passwordHash) {
        continue;
      }

      const isValidPassword = await argon2
        .verify(security.passwordHash, password)
        .catch(() => false);

      if (!isValidPassword) {
        continue;
      }

      const workspaceUser = await this.findActiveWorkspaceUser(security);

      if (workspaceUser) {
        return { security, workspaceUser };
      }
    }

    return null;
  }

  private async findSecurityForPasswordReset(email: string) {
    const securityRecords = await this.securityRepository.find({
      where: { currentEmail: email },
      order: { updatedAt: 'DESC' },
    });

    for (const security of securityRecords) {
      const workspaceUser = await this.findActiveWorkspaceUser(security);

      if (workspaceUser) {
        return security;
      }
    }

    return null;
  }

  private findActiveWorkspaceUser(security: UserSecuritySettingsEntity) {
    return this.workspaceUsersRepository.findOne({
      where: {
        tenantId: security.tenantId,
        userId: security.userId,
        status: 'active',
      },
      order: { updatedAt: 'DESC' },
    });
  }

  async forgotPasswordForUser(tenantId: string, userId: string) {
    const security = await this.securityRepository.findOne({
      where: { tenantId, userId },
    });

    if (!security?.currentEmail) {
      return { success: true, email: null };
    }

    await this.sendPasswordResetEmail(security, security.currentEmail);

    return { success: true, email: security.currentEmail };
  }

  private async sendPasswordResetEmail(
    security: UserSecuritySettingsEntity,
    email: string,
  ) {
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.passwordResetRepository.save({
      tenantId: security.tenantId,
      userId: security.userId,
      tokenHash,
      expiresAt,
    });

    const frontendUrl =
      this.configService.get<string>('APP_FRONTEND_URL') ??
      'http://82.29.61.35:3001';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;
    const preferences = await this.userPreferencesRepository.findOne({
      where: {
        tenantId: security.tenantId,
        userId: security.userId,
      },
    });
    const emailTemplate = this.getPasswordResetEmailTemplate(
      preferences?.locale ?? 'pt-BR',
      resetUrl,
    );

    await this.emailService.sendEmail({
      to: email,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
      text: emailTemplate.text,
    });
  }

  private getPasswordResetEmailTemplate(
    locale: PasswordResetEmailLocale,
    resetUrl: string,
  ) {
    const copy = passwordResetEmailCopies[locale];

    return {
      subject: copy.subject,
      html: `
        <h2>${copy.title}</h2>
        <p>${copy.intro}</p>
        <a href="${resetUrl}">${resetUrl}</a>
        <p>${copy.expiration}</p>
      `,
      text: `${copy.title}\n\n${copy.intro}\n${resetUrl}\n\n${copy.expiration}`,
    };
  }

  async resetPassword(token: string, password: string) {
    const tokenHash = this.hashToken(token);

    const resetRequest = await this.passwordResetRepository.findOne({
      where: { tokenHash },
      order: { createdAt: 'DESC' },
    });

    if (!resetRequest || resetRequest.usedAt) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    if (resetRequest.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const security = await this.securityRepository.findOne({
      where: {
        tenantId: resetRequest.tenantId,
        userId: resetRequest.userId,
      },
    });

    if (!security) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    security.passwordHash = await argon2.hash(password);
    security.passwordUpdatedAt = new Date();

    resetRequest.usedAt = new Date();

    await this.securityRepository.save(security);
    await this.passwordResetRepository.save(resetRequest);

    await this.sessionsRepository.update(
      {
        tenantId: resetRequest.tenantId,
        userId: resetRequest.userId,
      },
      {
        status: 'expired',
        revokedAt: new Date(),
      },
    );

    return { success: true };
  }

  async sendTwoFactorEmail(token: string) {
    const payload = await this.verifyTwoFactorToken(token);

    const security = await this.securityRepository.findOne({
      where: {
        tenantId: payload.tenantId,
        userId: payload.sub,
      },
    });

    if (!security || !this.hasTwoFactorEnabled(security)) {
      throw new UnauthorizedException('2FA not configured');
    }

    if (payload.method !== 'email') {
      throw new UnauthorizedException('Invalid 2FA method');
    }

    await this.sendEmailTwoFactorCode(
      security.tenantId,
      security.userId,
      security.currentEmail,
      'login',
    );

    return { success: true };
  }

  async verifyTwoFactorEmail(token: string, code: string, req: Request) {
    const payload = await this.verifyTwoFactorToken(token);

    if (payload.method !== 'email') {
      throw new UnauthorizedException('Invalid 2FA method');
    }

    await this.verifyEmailTwoFactorCode(
      payload.tenantId,
      payload.sub,
      code,
      'login',
    );

    return this.createSessionAfter2FA(
      payload.sub,
      payload.tenantId,
      extractLoginContext(req),
    );
  }

  async sendTwoFactorSetupEmail(
    tenantId: string,
    userId: string,
    email: string,
  ) {
    await this.sendEmailTwoFactorCode(tenantId, userId, email, 'setup');

    return { success: true };
  }

  async verifyEmailTwoFactorCode(
    tenantId: string,
    userId: string,
    code: string,
    purpose: EmailTwoFactorPurpose,
  ) {
    const [record] = await this.emailTwoFactorRepository.find({
      where: {
        tenantId,
        userId,
        purpose,
      },
      order: { createdAt: 'DESC' },
      take: 1,
    });

    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    if (record.attempts >= 5) {
      throw new UnauthorizedException('Invalid or expired code');
    }

    const isValid = this.hashToken(code) === record.codeHash;

    if (!isValid) {
      await this.emailTwoFactorRepository.update(
        { id: record.id },
        { attempts: record.attempts + 1 },
      );
      throw new UnauthorizedException('Invalid code');
    }

    await this.emailTwoFactorRepository.update(
      { id: record.id },
      { usedAt: new Date() },
    );
  }

  private async sendEmailTwoFactorCode(
    tenantId: string,
    userId: string,
    email: string,
    purpose: EmailTwoFactorPurpose,
  ) {
    if (!email) {
      throw new UnauthorizedException('2FA email not configured');
    }

    const code = randomInt(100000, 1000000).toString();

    await this.emailTwoFactorRepository.save(
      this.emailTwoFactorRepository.create({
        tenantId,
        userId,
        codeHash: this.hashToken(code),
        purpose,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        usedAt: null,
        attempts: 0,
      }),
    );

    const { html, text } = renderTransactionalEmail({
      title: 'Código de verificação',
      intro: `Seu código de verificação é ${code}.`,
      secondaryText: 'Este código expira em 10 minutos.',
      footerText:
        'Este é um e-mail automático de segurança da Lyra Suite. Se você não reconhece esta ação, recomendamos redefinir sua senha imediatamente.',
    });

    await this.emailService.sendEmail({
      to: email,
      subject: 'Código de verificação - Lyra Suite',
      html,
      text,
    });
  }

  async sendPasswordChangedEmail(email: string) {
    if (!email) return;

    const { html, text } = renderTransactionalEmail({
      title: 'Senha alterada',
      intro: 'Sua senha foi alterada com sucesso.',
      secondaryText:
        'Se você não realizou essa alteração, redefina sua senha imediatamente.',
    });

    await this.emailService.sendEmail({
      to: email,
      subject: 'Sua senha foi alterada - Lyra Suite',
      html,
      text,
    });
  }

  async sendEmailChangedEmail(email: string) {
    if (!email) return;

    const { html, text } = renderTransactionalEmail({
      title: 'E-mail atualizado',
      intro: 'Seu e-mail de acesso foi alterado.',
      secondaryText:
        'Se você não realizou essa alteração, entre em contato com o suporte imediatamente.',
    });

    await this.emailService.sendEmail({
      to: email,
      subject: 'Seu e-mail foi alterado - Lyra Suite',
      html,
      text,
    });
  }

  async sendTwoFactorEnabledEmail(email: string) {
    if (!email) return;

    const { html, text } = renderTransactionalEmail({
      title: '2FA ativado',
      intro: 'A verificação em duas etapas foi ativada na sua conta.',
      secondaryText: 'Isso aumenta a segurança do seu acesso ao Lyra Suite.',
    });

    await this.emailService.sendEmail({
      to: email,
      subject: '2FA ativado - Lyra Suite',
      html,
      text,
    });
  }

  async sendTwoFactorDisabledEmail(email: string) {
    if (!email) return;

    const { html, text } = renderTransactionalEmail({
      title: '2FA desativado',
      intro: 'A verificação em duas etapas foi desativada.',
      secondaryText: 'Recomendamos ativar novamente para maior segurança.',
    });

    await this.emailService.sendEmail({
      to: email,
      subject: '2FA desativado - Lyra Suite',
      html,
      text,
    });
  }
}
