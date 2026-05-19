import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomInt } from 'crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import * as QRCode from 'qrcode';
import { IsNull, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { FilesService } from '../../common/files/files.service';
import { EmailService } from '../email/email.service';
import { renderTransactionalEmail } from '../email/templates/transactional-email.template';
import {
  AgencyEmailTwoFactorCodeEntity,
  AgencyUserSecuritySettingsEntity,
  AgencyUserSessionEntity,
  AgencyUserTrustedDeviceEntity,
} from './entities/agency-auth.entities';
import {
  AgencyUserNotificationPreferencesEntity,
  AgencyUserPreferencesEntity,
  AgencyUserProfileEntity,
  AgencyWorkspaceAdvancedSettingsEntity,
  AgencyWorkspaceAppsSettingsEntity,
  AgencyWorkspaceCompanySettingsEntity,
  AgencyWorkspaceEmailSettingsEntity,
  AgencyWorkspaceFinanceSettingsEntity,
  AgencyWorkspaceIntegrationEntity,
  AgencyWorkspaceNotificationSettingsEntity,
  AgencyWorkspaceSecuritySettingsEntity,
  AgencyWorkspaceSubscriptionSettingsEntity,
  AgencyWorkspaceUserEntity,
  AgencyWorkspaceUserPermissionEntity,
} from './entities/agency-settings.entities';
import {
  ConfirmAgencyTwoFactorDto,
  InviteAgencyWorkspaceUserDto,
  PatchAgencyAdvancedDto,
  PatchAgencyAppsDto,
  PatchAgencyEmailDto,
  PatchAgencyFinanceDto,
  PatchAgencyIntegrationsDto,
  PatchAgencyNotificationsDto,
  PatchAgencyPermissionMatrixDto,
  PatchAgencySecurityDto,
  PatchAgencySubscriptionsDto,
  PatchAgencyUserPreferencesDto,
  PatchAgencyUserProfileDto,
  PatchAgencyUserSecurityDto,
  PatchAgencyWorkspaceCompanyDto,
  PatchAgencyWorkspaceUserAccessDto,
  SetupAgencyTwoFactorDto,
} from './dto/agency-settings.dto';

const AGENCY_CONNECTION = 'agency';
const AGENCY_APP_KEYS = [
  'dashboard',
  'messages',
  'projects',
  'tasks',
  'calendar',
  'clients',
  'sales',
  'finance',
  'profitability',
  'settings',
] as const;
const AGENCY_WORKSPACE_ROLES = [
  'owner',
  'admin',
  'manager',
  'member',
] as const;
type AgencyWorkspaceRoleKey = (typeof AGENCY_WORKSPACE_ROLES)[number];
type AgencyPermissionAccessValue = 'full' | 'partial' | 'blocked';
type AgencyPermissionMatrix = Record<
  string,
  Record<AgencyWorkspaceRoleKey, AgencyPermissionAccessValue>
>;

@Injectable()
export class AgencySettingsService {
  constructor(
    @InjectRepository(AgencyUserPreferencesEntity, AGENCY_CONNECTION)
    private readonly preferencesRepo: Repository<AgencyUserPreferencesEntity>,
    @InjectRepository(AgencyUserProfileEntity, AGENCY_CONNECTION)
    private readonly profileRepo: Repository<AgencyUserProfileEntity>,
    @InjectRepository(AgencyWorkspaceCompanySettingsEntity, AGENCY_CONNECTION)
    private readonly companyRepo: Repository<AgencyWorkspaceCompanySettingsEntity>,
    @InjectRepository(AgencyWorkspaceEmailSettingsEntity, AGENCY_CONNECTION)
    private readonly emailRepo: Repository<AgencyWorkspaceEmailSettingsEntity>,
    @InjectRepository(
      AgencyWorkspaceNotificationSettingsEntity,
      AGENCY_CONNECTION,
    )
    private readonly workspaceNotificationsRepo: Repository<AgencyWorkspaceNotificationSettingsEntity>,
    @InjectRepository(
      AgencyUserNotificationPreferencesEntity,
      AGENCY_CONNECTION,
    )
    private readonly userNotificationPreferencesRepo: Repository<AgencyUserNotificationPreferencesEntity>,
    @InjectRepository(AgencyWorkspaceSecuritySettingsEntity, AGENCY_CONNECTION)
    private readonly workspaceSecurityRepo: Repository<AgencyWorkspaceSecuritySettingsEntity>,
    @InjectRepository(AgencyUserSecuritySettingsEntity, AGENCY_CONNECTION)
    private readonly userSecurityRepo: Repository<AgencyUserSecuritySettingsEntity>,
    @InjectRepository(AgencyUserSessionEntity, AGENCY_CONNECTION)
    private readonly userSessionsRepo: Repository<AgencyUserSessionEntity>,
    @InjectRepository(AgencyUserTrustedDeviceEntity, AGENCY_CONNECTION)
    private readonly trustedDevicesRepo: Repository<AgencyUserTrustedDeviceEntity>,
    @InjectRepository(AgencyEmailTwoFactorCodeEntity, AGENCY_CONNECTION)
    private readonly emailTwoFactorRepo: Repository<AgencyEmailTwoFactorCodeEntity>,
    @InjectRepository(AgencyWorkspaceAppsSettingsEntity, AGENCY_CONNECTION)
    private readonly appsRepo: Repository<AgencyWorkspaceAppsSettingsEntity>,
    @InjectRepository(AgencyWorkspaceFinanceSettingsEntity, AGENCY_CONNECTION)
    private readonly financeRepo: Repository<AgencyWorkspaceFinanceSettingsEntity>,
    @InjectRepository(
      AgencyWorkspaceSubscriptionSettingsEntity,
      AGENCY_CONNECTION,
    )
    private readonly subscriptionsRepo: Repository<AgencyWorkspaceSubscriptionSettingsEntity>,
    @InjectRepository(AgencyWorkspaceAdvancedSettingsEntity, AGENCY_CONNECTION)
    private readonly advancedRepo: Repository<AgencyWorkspaceAdvancedSettingsEntity>,
    @InjectRepository(AgencyWorkspaceIntegrationEntity, AGENCY_CONNECTION)
    private readonly integrationsRepo: Repository<AgencyWorkspaceIntegrationEntity>,
    @InjectRepository(AgencyWorkspaceUserEntity, AGENCY_CONNECTION)
    private readonly workspaceUsersRepo: Repository<AgencyWorkspaceUserEntity>,
    @InjectRepository(AgencyWorkspaceUserPermissionEntity, AGENCY_CONNECTION)
    private readonly permissionsRepo: Repository<AgencyWorkspaceUserPermissionEntity>,
    private readonly filesService: FilesService,
    private readonly cryptoService: SettingsCryptoService,
    private readonly emailService: EmailService,
  ) {}

  async getPreferences(tenantId: string, userId: string) {
    return (
      (await this.preferencesRepo.findOne({ where: { tenantId, userId } })) ??
      this.preferencesRepo.create({ tenantId, userId })
    );
  }

  async patchPreferences(
    tenantId: string,
    userId: string,
    dto: PatchAgencyUserPreferencesDto,
  ) {
    await this.preferencesRepo.upsert({ tenantId, userId, ...dto }, [
      'tenantId',
      'userId',
    ]);

    return this.getPreferences(tenantId, userId);
  }

  async getProfile(tenantId: string, userId: string) {
    return (
      (await this.profileRepo.findOne({ where: { tenantId, userId } })) ??
      this.profileRepo.create({ tenantId, userId })
    );
  }

  async patchProfile(
    tenantId: string,
    userId: string,
    dto: PatchAgencyUserProfileDto,
  ) {
    await this.profileRepo.upsert(
      {
        tenantId,
        userId,
        ...dto,
        phone: dto.phone ?? null,
        jobTitle: dto.jobTitle ?? null,
      },
      ['tenantId', 'userId'],
    );

    return this.getProfile(tenantId, userId);
  }

  async uploadProfileAvatar(
    tenantId: string,
    userId: string,
    file: Express.Multer.File,
  ) {
    const stored = await this.filesService.uploadImageAsset({
      file,
      path: `agency/tenants/${tenantId}/users/${userId}/avatar-${Date.now()}.webp`,
      maxDimension: 512,
    });

    await this.profileRepo.upsert(
      {
        tenantId,
        userId,
        avatarUrl: stored.url,
        avatarPath: stored.path,
      },
      ['tenantId', 'userId'],
    );

    return {
      avatarUrl: stored.url,
      avatarPath: stored.path,
    };
  }

  async getCompany(tenantId: string, workspaceId: string) {
    return (
      (await this.companyRepo.findOne({ where: { tenantId, workspaceId } })) ??
      this.companyRepo.create({ tenantId, workspaceId })
    );
  }

  async patchCompany(
    tenantId: string,
    workspaceId: string,
    dto: PatchAgencyWorkspaceCompanyDto,
  ) {
    await this.companyRepo.upsert(
      {
        tenantId,
        workspaceId,
        ...dto,
        website: dto.website ?? null,
        supportEmail: dto.supportEmail ?? null,
        billingEmail: dto.billingEmail ?? null,
        phone: dto.phone ?? null,
        addressLine: dto.addressLine ?? null,
        industry: dto.industry ?? null,
        companySize: dto.companySize ?? null,
      },
      ['tenantId', 'workspaceId'],
    );

    return this.getCompany(tenantId, workspaceId);
  }

  async uploadCompanyLogo(
    tenantId: string,
    workspaceId: string,
    file: Express.Multer.File,
  ) {
    const stored = await this.filesService.uploadImageAsset({
      file,
      path: `agency/tenants/${tenantId}/workspaces/${workspaceId}/logo-${Date.now()}.webp`,
      maxDimension: 1024,
    });

    await this.companyRepo.upsert(
      {
        tenantId,
        workspaceId,
        logoUrl: stored.url,
        logoPath: stored.path,
      },
      ['tenantId', 'workspaceId'],
    );

    return {
      logoUrl: stored.url,
      logoPath: stored.path,
    };
  }

  async uploadCompanyAvatar(
    tenantId: string,
    workspaceId: string,
    file: Express.Multer.File,
  ) {
    const stored = await this.filesService.uploadImageAsset({
      file,
      path: `agency/tenants/${tenantId}/workspaces/${workspaceId}/avatar-${Date.now()}.webp`,
      maxDimension: 512,
    });

    await this.companyRepo.upsert(
      {
        tenantId,
        workspaceId,
        avatarUrl: stored.url,
        avatarPath: stored.path,
      },
      ['tenantId', 'workspaceId'],
    );

    return {
      avatarUrl: stored.url,
      avatarPath: stored.path,
    };
  }

  async getNotifications(
    tenantId: string,
    workspaceId: string,
    userId: string,
  ) {
    const [workspaceSettings, userPreferences] = await Promise.all([
      this.getWorkspaceNotificationSettings(tenantId, workspaceId),
      this.getUserNotificationPreferences(tenantId, userId),
    ]);

    return {
      workspaceSettings,
      userPreferences,
      history: [],
    };
  }

  async patchNotifications(
    tenantId: string,
    workspaceId: string,
    userId: string,
    dto: PatchAgencyNotificationsDto,
  ) {
    await Promise.all([
      this.workspaceNotificationsRepo.upsert(
        {
          tenantId,
          workspaceId,
          quietHoursEnabled: dto.quietHoursEnabled,
          quietHours: dto.quietHours as never,
          historyLimit: dto.historyLimit,
        },
        ['tenantId', 'workspaceId'],
      ),
      this.userNotificationPreferencesRepo.upsert(
        {
          tenantId,
          userId,
          preferences: dto.preferences as never,
        },
        ['tenantId', 'userId'],
      ),
    ]);

    return this.getNotifications(tenantId, workspaceId, userId);
  }

  async getSecurity(
    tenantId: string,
    userId: string,
    currentSessionId?: string,
  ) {
    const [settings, sessions, trustedDevices] = await Promise.all([
      this.getUserSecuritySettings(tenantId, userId),
      this.getUserSessions(tenantId, userId, currentSessionId),
      this.getTrustedDevices(tenantId, userId),
    ]);

    return {
      settings,
      sessions,
      trustedDevices,
      summary: {
        activeSessions: sessions.filter((session) => session.status !== 'expired')
          .length,
        trustedDevices: trustedDevices.length,
        twoFactorStatus: settings.twoFactorEnabled
          ? 'enabled'
          : settings.twoFactorPending
            ? 'pending'
            : 'disabled',
      },
    };
  }

  async patchSecurity(
    tenantId: string,
    userId: string,
    dto: PatchAgencyUserSecurityDto,
    currentSessionId?: string,
  ) {
    const existing = await this.userSecurityRepo.findOne({
      where: { tenantId, userId },
    });

    await this.userSecurityRepo.upsert(
      {
        tenantId,
        userId,
        currentEmail: existing?.currentEmail ?? '',
        passwordHash: existing?.passwordHash ?? null,
        passwordUpdatedAt: existing?.passwordUpdatedAt ?? null,
        twoFactorEnabled: existing?.twoFactorEnabled ?? false,
        twoFactorMethod: existing?.twoFactorMethod ?? 'authenticator',
        twoFactorSecretEncrypted: existing?.twoFactorSecretEncrypted ?? null,
        twoFactorPendingSecretEncrypted:
          existing?.twoFactorPendingSecretEncrypted ?? null,
        loginAlertsEnabled:
          dto.loginAlertsEnabled ?? existing?.loginAlertsEnabled ?? true,
        trustedDevicesEnabled:
          dto.trustedDevicesEnabled ?? existing?.trustedDevicesEnabled ?? true,
      },
      ['tenantId', 'userId'],
    );

    return this.getSecurity(tenantId, userId, currentSessionId);
  }

  async setupTwoFactor(
    tenantId: string,
    userId: string,
    dto: SetupAgencyTwoFactorDto,
  ) {
    const method = dto.method ?? 'authenticator';
    const existing = await this.userSecurityRepo.findOne({
      where: { tenantId, userId },
    });

    if (method === 'email') {
      const email = existing?.currentEmail;

      if (!email) {
        throw new BadRequestException(
          'No email configured for two-factor setup.',
        );
      }

      await this.sendEmailTwoFactorCode(tenantId, userId, email);

      return {
        method: 'email' as const,
        email,
      };
    }

    const secret = generateSecret();
    const encrypted = this.cryptoService.encrypt(secret);
    const otpauth = generateURI({
      issuer: 'Lyra Agency',
      label: existing?.currentEmail || userId,
      secret,
    });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

    await this.userSecurityRepo.upsert(
      {
        tenantId,
        userId,
        currentEmail: existing?.currentEmail ?? '',
        passwordHash: existing?.passwordHash ?? null,
        passwordUpdatedAt: existing?.passwordUpdatedAt ?? null,
        twoFactorEnabled: existing?.twoFactorEnabled ?? false,
        twoFactorMethod: existing?.twoFactorMethod ?? 'authenticator',
        twoFactorSecretEncrypted: existing?.twoFactorSecretEncrypted ?? null,
        twoFactorPendingSecretEncrypted: encrypted,
        loginAlertsEnabled: existing?.loginAlertsEnabled ?? true,
        trustedDevicesEnabled: existing?.trustedDevicesEnabled ?? true,
      },
      ['tenantId', 'userId'],
    );

    return {
      method: 'authenticator' as const,
      qrCodeDataUrl,
      otpauth,
    };
  }

  async confirmTwoFactor(
    tenantId: string,
    userId: string,
    dto: ConfirmAgencyTwoFactorDto,
    currentSessionId?: string,
  ) {
    const method = dto.method ?? 'authenticator';
    const existing = await this.userSecurityRepo.findOne({
      where: { tenantId, userId },
    });

    if (method === 'email') {
      await this.verifyEmailTwoFactorCode(tenantId, userId, dto.code);

      await this.userSecurityRepo.update(
        { tenantId, userId },
        {
          twoFactorEnabled: true,
          twoFactorMethod: 'email',
          twoFactorSecretEncrypted: null,
          twoFactorPendingSecretEncrypted: null,
        },
      );

      return this.getSecurity(tenantId, userId, currentSessionId);
    }

    const pendingSecret = this.cryptoService.decrypt(
      existing?.twoFactorPendingSecretEncrypted,
    );

    if (!pendingSecret) {
      throw new BadRequestException('No pending two-factor setup.');
    }

    const verification = await verify({
      token: dto.code.trim(),
      secret: pendingSecret,
    });

    if (!verification.valid) {
      throw new BadRequestException('Invalid two-factor code.');
    }

    await this.userSecurityRepo.update(
      { tenantId, userId },
      {
        twoFactorEnabled: true,
        twoFactorMethod: 'authenticator',
        twoFactorSecretEncrypted:
          existing?.twoFactorPendingSecretEncrypted ?? null,
        twoFactorPendingSecretEncrypted: null,
      },
    );

    return this.getSecurity(tenantId, userId, currentSessionId);
  }

  async disableTwoFactor(
    tenantId: string,
    userId: string,
    currentSessionId?: string,
  ) {
    await this.userSecurityRepo.update(
      { tenantId, userId },
      {
        twoFactorEnabled: false,
        twoFactorMethod: 'authenticator',
        twoFactorSecretEncrypted: null,
        twoFactorPendingSecretEncrypted: null,
      },
    );

    return this.getSecurity(tenantId, userId, currentSessionId);
  }

  async revokeSecuritySession(
    tenantId: string,
    userId: string,
    sessionId: string,
    currentSessionId?: string,
  ) {
    if (currentSessionId && sessionId === currentSessionId) {
      throw new BadRequestException('Current session cannot be revoked here.');
    }

    const session = await this.userSessionsRepo.findOne({
      where: { tenantId, userId, id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('Agency user session not found.');
    }

    await this.userSessionsRepo.update(
      { tenantId, userId, id: sessionId },
      {
        status: 'expired',
        revokedAt: new Date(),
      },
    );

    return this.getSecurity(tenantId, userId, currentSessionId);
  }

  async revokeTrustedDevice(
    tenantId: string,
    userId: string,
    deviceId: string,
    currentSessionId?: string,
  ) {
    const device = await this.trustedDevicesRepo.findOne({
      where: { tenantId, userId, id: deviceId, revokedAt: IsNull() },
    });

    if (!device) {
      throw new NotFoundException('Agency trusted device not found.');
    }

    device.revokedAt = new Date();
    await this.trustedDevicesRepo.save(device);

    return this.getSecurity(tenantId, userId, currentSessionId);
  }

  async getWorkspaceSecurity(tenantId: string, workspaceId: string) {
    return (
      (await this.workspaceSecurityRepo.findOne({
        where: { tenantId, workspaceId },
      })) ??
      this.workspaceSecurityRepo.create({
        tenantId,
        workspaceId,
        emailDomain: this.getAgencyEmailDomain(),
        emailTemplates: this.getDefaultSecurityEmailTemplates(),
      })
    );
  }

  async patchWorkspaceSecurity(
    tenantId: string,
    workspaceId: string,
    dto: PatchAgencySecurityDto,
  ) {
    await this.workspaceSecurityRepo.upsert(
      {
        tenantId,
        workspaceId,
        ...dto,
        emailTemplates: dto.emailTemplates as never,
      },
      ['tenantId', 'workspaceId'],
    );

    return this.getWorkspaceSecurity(tenantId, workspaceId);
  }

  async getApps(tenantId: string, workspaceId: string) {
    return (
      (await this.appsRepo.findOne({ where: { tenantId, workspaceId } })) ??
      this.appsRepo.create({
        tenantId,
        workspaceId,
        apps: AGENCY_APP_KEYS.map((appKey) => ({
          appKey,
          enabled: true,
        })),
      })
    );
  }

  async patchApps(
    tenantId: string,
    workspaceId: string,
    dto: PatchAgencyAppsDto,
  ) {
    await this.appsRepo.upsert(
      { tenantId, workspaceId, apps: dto.apps as never },
      ['tenantId', 'workspaceId'],
    );

    return this.getApps(tenantId, workspaceId);
  }

  async getEmail(tenantId: string, workspaceId: string) {
    const entity =
      (await this.emailRepo.findOne({ where: { tenantId, workspaceId } })) ??
      this.emailRepo.create({
        tenantId,
        workspaceId,
        provider: 'smtp_imap',
        fromName: '',
        fromEmail: null,
        replyToEmail: null,
        smtpHost: null,
        smtpPort: null,
        smtpSecure: true,
        smtpUser: null,
        smtpPasswordEncrypted: null,
        imapHost: null,
        imapPort: null,
        imapSecure: true,
        imapUser: null,
        imapPasswordEncrypted: null,
        status: 'not_configured',
      });

    return this.serializeEmailSettings(entity);
  }

  async patchEmail(
    tenantId: string,
    workspaceId: string,
    dto: PatchAgencyEmailDto,
  ) {
    const existing = await this.emailRepo.findOne({
      where: { tenantId, workspaceId },
    });

    const smtpPassword = this.normalizeNullableString(dto.smtpPassword);
    const imapPassword = this.normalizeNullableString(dto.imapPassword);
    const smtpHost = this.normalizeNullableString(dto.smtpHost);
    const imapHost = this.normalizeNullableString(dto.imapHost);
    const fromEmail = this.normalizeNullableString(dto.fromEmail);
    const replyToEmail = this.normalizeNullableString(dto.replyToEmail);

    await this.emailRepo.upsert(
      {
        tenantId,
        workspaceId,
        provider: dto.provider ?? existing?.provider ?? 'smtp_imap',
        fromName: dto.fromName ?? existing?.fromName ?? '',
        fromEmail,
        replyToEmail,
        smtpHost,
        smtpPort: dto.smtpPort ?? existing?.smtpPort ?? null,
        smtpSecure: dto.smtpSecure ?? existing?.smtpSecure ?? true,
        smtpUser: this.normalizeNullableString(dto.smtpUser),
        smtpPasswordEncrypted: smtpPassword
          ? this.cryptoService.encrypt(smtpPassword)
          : existing?.smtpPasswordEncrypted ?? null,
        imapHost,
        imapPort: dto.imapPort ?? existing?.imapPort ?? null,
        imapSecure: dto.imapSecure ?? existing?.imapSecure ?? true,
        imapUser: this.normalizeNullableString(dto.imapUser),
        imapPasswordEncrypted: imapPassword
          ? this.cryptoService.encrypt(imapPassword)
          : existing?.imapPasswordEncrypted ?? null,
        status:
          dto.status ??
          this.resolveEmailStatus({
            fromEmail,
            smtpHost,
            imapHost,
            existingStatus: existing?.status,
          }),
      },
      ['tenantId', 'workspaceId'],
    );

    return this.getEmail(tenantId, workspaceId);
  }

  async getFinance(tenantId: string, workspaceId: string) {
    const entity =
      (await this.financeRepo.findOne({ where: { tenantId, workspaceId } })) ??
      this.financeRepo.create({ tenantId, workspaceId });

    return this.serializeFinanceSettings(entity);
  }

  async patchFinance(
    tenantId: string,
    workspaceId: string,
    dto: PatchAgencyFinanceDto,
  ) {
    const settings = {
      taxDocumentType: dto.taxDocumentType,
      taxDocument: dto.taxDocument ?? null,
      fiscalRegime: dto.fiscalRegime ?? null,
      invoicePrefix: dto.invoicePrefix,
      nextInvoiceNumber: dto.nextInvoiceNumber,
      defaultPaymentTerms: dto.defaultPaymentTerms,
      defaultLateFee: dto.defaultLateFee,
      defaultMonthlyInterest: dto.defaultMonthlyInterest,
      billingEmail: dto.billingEmail ?? null,
      fiscalEmail: dto.fiscalEmail ?? null,
    };

    await this.financeRepo.upsert(
      {
        tenantId,
        workspaceId,
        country: dto.country,
        currency: dto.currency,
        settings: settings as never,
      },
      ['tenantId', 'workspaceId'],
    );

    return this.getFinance(tenantId, workspaceId);
  }

  async getSubscriptions(tenantId: string, workspaceId: string) {
    return (
      (await this.subscriptionsRepo.findOne({
        where: { tenantId, workspaceId },
      })) ?? this.subscriptionsRepo.create({ tenantId, workspaceId })
    );
  }

  async patchSubscriptions(
    tenantId: string,
    workspaceId: string,
    dto: PatchAgencySubscriptionsDto,
  ) {
    await this.subscriptionsRepo.upsert(
      { tenantId, workspaceId, ...dto, limits: dto.limits as never },
      ['tenantId', 'workspaceId'],
    );

    return this.getSubscriptions(tenantId, workspaceId);
  }

  async getAdvanced(tenantId: string, workspaceId: string) {
    return (
      (await this.advancedRepo.findOne({ where: { tenantId, workspaceId } })) ??
      this.advancedRepo.create({ tenantId, workspaceId })
    );
  }

  async patchAdvanced(
    tenantId: string,
    workspaceId: string,
    dto: PatchAgencyAdvancedDto,
  ) {
    await this.advancedRepo.upsert(
      { tenantId, workspaceId, ...dto, settings: dto.settings as never },
      ['tenantId', 'workspaceId'],
    );

    return this.getAdvanced(tenantId, workspaceId);
  }

  async getIntegrations(tenantId: string, workspaceId: string) {
    return this.integrationsRepo.find({
      where: { tenantId, workspaceId },
      order: { category: 'ASC', sidebarOrder: 'ASC', itemId: 'ASC' },
    });
  }

  async patchIntegrations(
    tenantId: string,
    workspaceId: string,
    dto: PatchAgencyIntegrationsDto,
  ) {
    for (const item of dto.items) {
      await this.integrationsRepo.upsert(
        {
          tenantId,
          workspaceId,
          ...item,
          sidebarOrder: item.sidebarOrder ?? null,
        },
        ['workspaceId', 'itemId'],
      );
    }

    return this.getIntegrations(tenantId, workspaceId);
  }

  async getWorkspaceUsers(
    tenantId: string,
    workspaceId: string,
    userId?: string,
  ) {
    let users = await this.workspaceUsersRepo.find({
      where: { tenantId, workspaceId },
      order: { createdAt: 'ASC' },
    });

    if (users.length === 0 && userId) {
      const owner = await this.workspaceUsersRepo.save(
        this.workspaceUsersRepo.create({
          tenantId,
          workspaceId,
          userId,
          name: 'Workspace Owner',
          email: 'owner@lyrasuite.com',
          role: 'owner',
          status: 'active',
          lastAccess: 'Agora',
        }),
      );

      await this.permissionsRepo.save(
        AGENCY_APP_KEYS.map((appKey) =>
          this.permissionsRepo.create({
            tenantId,
            workspaceId,
            workspaceUserId: owner.id,
            appKey,
            access: 'full',
          }),
        ),
      );

      users = await this.workspaceUsersRepo.find({
        where: { tenantId, workspaceId },
        order: { createdAt: 'ASC' },
      });
    }

    return Promise.all(
      users.map(async (user) => ({
        ...user,
        permissions: await this.permissionsRepo.find({
          where: { tenantId, workspaceId, workspaceUserId: user.id },
          order: { appKey: 'ASC' },
        }),
      })),
    );
  }

  async inviteWorkspaceUser(
    tenantId: string,
    workspaceId: string,
    dto: InviteAgencyWorkspaceUserDto,
  ) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const permissionMatrix = await this.getPermissionMatrix(tenantId, workspaceId);

    const user = await this.workspaceUsersRepo.save(
      this.workspaceUsersRepo.create({
        tenantId,
        workspaceId,
        userId: null,
        name: normalizedEmail.split('@')[0] || 'Novo membro',
        email: normalizedEmail,
        role: dto.role,
        status: 'invited',
        lastAccess: 'Convite pendente',
      }),
    );

    await this.permissionsRepo.save(
      AGENCY_APP_KEYS.map((appKey) =>
        this.permissionsRepo.create({
          tenantId,
          workspaceId,
          workspaceUserId: user.id,
          appKey,
          access: permissionMatrix.matrix[appKey]?.[dto.role] ?? 'partial',
        }),
      ),
    );

    return this.getWorkspaceUsers(tenantId, workspaceId);
  }

  async getPermissionMatrix(tenantId: string, workspaceId: string) {
    const [appsSettings, users] = await Promise.all([
      this.getApps(tenantId, workspaceId),
      this.getWorkspaceUsers(tenantId, workspaceId),
    ]);
    const appKeys = Array.from(
      new Set([
        ...AGENCY_APP_KEYS,
        ...users.flatMap((user) =>
          user.permissions.map((permission) => permission.appKey),
        ),
      ]),
    );
    const storedMatrix = this.readPermissionMatrixFromApps(
      appsSettings.apps ?? [],
    );
    const matrix = Object.fromEntries(
      appKeys.map((appKey) => [
        appKey,
        Object.fromEntries(
          AGENCY_WORKSPACE_ROLES.map((role) => {
            if (role === 'owner') {
              return [role, 'full'];
            }

            const storedAccess = storedMatrix[appKey]?.[role];
            if (storedAccess) {
              return [role, storedAccess];
            }

            const userWithRole = users.find((user) => user.role === role);
            const permission = userWithRole?.permissions.find(
              (item) => item.appKey === appKey,
            );

            return [role, permission?.access ?? 'blocked'];
          }),
        ),
      ]),
    ) as AgencyPermissionMatrix;

    return {
      appKeys,
      matrix,
    };
  }

  async patchPermissionMatrix(
    tenantId: string,
    workspaceId: string,
    dto: PatchAgencyPermissionMatrixDto,
  ) {
    const normalizedMatrix = this.normalizePermissionMatrix(dto.matrix);
    const appsSettings = await this.getApps(tenantId, workspaceId);
    const appKeys = Array.from(
      new Set([...AGENCY_APP_KEYS, ...Object.keys(normalizedMatrix)]),
    );
    const appsByKey = new Map(
      (appsSettings.apps ?? [])
        .filter((item) => typeof item.appKey === 'string')
        .map((item) => [String(item.appKey), item]),
    );

    await this.appsRepo.upsert(
      {
        tenantId,
        workspaceId,
        apps: appKeys.map((appKey) => ({
          ...(appsByKey.get(appKey) ?? { appKey, enabled: true }),
          appKey,
          permissionsByRole: normalizedMatrix[appKey],
        })) as never,
      },
      ['tenantId', 'workspaceId'],
    );

    const users = await this.workspaceUsersRepo.find({
      where: { tenantId, workspaceId },
    });

    for (const user of users.filter((item) => item.role !== 'owner')) {
      for (const appKey of appKeys) {
        await this.permissionsRepo.upsert(
          {
            tenantId,
            workspaceId,
            workspaceUserId: user.id,
            appKey,
            access: normalizedMatrix[appKey]?.[user.role] ?? 'blocked',
          },
          ['workspaceUserId', 'appKey'],
        );
      }
    }

    const [nextUsers, nextMatrix] = await Promise.all([
      this.getWorkspaceUsers(tenantId, workspaceId),
      this.getPermissionMatrix(tenantId, workspaceId),
    ]);

    return {
      users: nextUsers,
      permissionMatrix: nextMatrix,
    };
  }

  async patchWorkspaceUserAccess(
    tenantId: string,
    workspaceId: string,
    workspaceUserId: string,
    dto: PatchAgencyWorkspaceUserAccessDto,
  ) {
    const user = await this.workspaceUsersRepo.findOne({
      where: { tenantId, workspaceId, id: workspaceUserId },
    });

    if (!user) {
      throw new NotFoundException('Agency workspace user not found.');
    }

    const nextRole = user.role === 'owner' ? 'owner' : dto.role;

    await this.workspaceUsersRepo.update(
      { tenantId, workspaceId, id: workspaceUserId },
      { role: nextRole },
    );

    for (const permission of dto.permissions) {
      await this.permissionsRepo.upsert(
        {
          tenantId,
          workspaceId,
          workspaceUserId,
          appKey: permission.appKey,
          access: nextRole === 'owner' ? 'full' : permission.access,
        },
        ['workspaceUserId', 'appKey'],
      );
    }

    return this.getWorkspaceUsers(tenantId, workspaceId);
  }

  async deactivateWorkspaceUser(
    tenantId: string,
    workspaceId: string,
    workspaceUserId: string,
  ) {
    const user = await this.workspaceUsersRepo.findOne({
      where: { tenantId, workspaceId, id: workspaceUserId },
    });

    if (!user) {
      throw new NotFoundException('Agency workspace user not found.');
    }

    if (user.role === 'owner') {
      throw new BadRequestException(
        'Agency workspace owner cannot be revoked.',
      );
    }

    await this.workspaceUsersRepo.update(
      { tenantId, workspaceId, id: workspaceUserId },
      { status: 'inactive' },
    );

    return this.getWorkspaceUsers(tenantId, workspaceId);
  }

  private serializeEmailSettings(entity: AgencyWorkspaceEmailSettingsEntity) {
    return {
      id: entity.id,
      tenantId: entity.tenantId,
      workspaceId: entity.workspaceId,
      provider: entity.provider,
      fromName: entity.fromName,
      fromEmail: entity.fromEmail,
      replyToEmail: entity.replyToEmail,
      smtpHost: entity.smtpHost,
      smtpPort: entity.smtpPort,
      smtpSecure: entity.smtpSecure,
      smtpUser: entity.smtpUser,
      smtpConfigured: Boolean(entity.smtpPasswordEncrypted),
      imapHost: entity.imapHost,
      imapPort: entity.imapPort,
      imapSecure: entity.imapSecure,
      imapUser: entity.imapUser,
      imapConfigured: Boolean(entity.imapPasswordEncrypted),
      status: entity.status,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private resolveEmailStatus(input: {
    fromEmail: string | null;
    smtpHost: string | null;
    imapHost: string | null;
    existingStatus?: string;
  }) {
    if (input.fromEmail || input.smtpHost || input.imapHost) {
      return 'configured';
    }

    return input.existingStatus ?? 'not_configured';
  }

  private serializeFinanceSettings(
    entity: AgencyWorkspaceFinanceSettingsEntity,
  ) {
    const settings = entity.settings ?? {};

    return {
      id: entity.id,
      tenantId: entity.tenantId,
      workspaceId: entity.workspaceId,
      country: entity.country ?? 'BR',
      currency: entity.currency ?? 'BRL',
      taxDocumentType: this.readStringSetting(
        settings,
        'taxDocumentType',
        'CNPJ',
      ),
      taxDocument: this.readNullableStringSetting(settings, 'taxDocument'),
      fiscalRegime: this.readNullableStringSetting(settings, 'fiscalRegime'),
      invoicePrefix: this.readStringSetting(settings, 'invoicePrefix', 'LA'),
      nextInvoiceNumber: this.readNumberSetting(
        settings,
        'nextInvoiceNumber',
        1,
      ),
      defaultPaymentTerms: this.readStringSetting(
        settings,
        'defaultPaymentTerms',
        '7 dias',
      ),
      defaultLateFee: this.readNumberSetting(settings, 'defaultLateFee', 2),
      defaultMonthlyInterest: this.readNumberSetting(
        settings,
        'defaultMonthlyInterest',
        1,
      ),
      billingEmail: this.readNullableStringSetting(settings, 'billingEmail'),
      fiscalEmail: this.readNullableStringSetting(settings, 'fiscalEmail'),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private normalizeNullableString(value: string | null | undefined) {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private readStringSetting(
    settings: Record<string, unknown>,
    key: string,
    fallback: string,
  ) {
    const value = settings[key];
    return typeof value === 'string' && value.trim() ? value : fallback;
  }

  private readNullableStringSetting(
    settings: Record<string, unknown>,
    key: string,
  ) {
    const value = settings[key];
    return typeof value === 'string' && value.trim() ? value : null;
  }

  private readNumberSetting(
    settings: Record<string, unknown>,
    key: string,
    fallback: number,
  ) {
    const value = settings[key];

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    }

    return fallback;
  }

  private isPermissionAccess(
    value: unknown,
  ): value is AgencyPermissionAccessValue {
    return value === 'full' || value === 'partial' || value === 'blocked';
  }

  private readPermissionMatrixFromApps(
    apps: Array<Record<string, unknown>>,
  ) {
    const matrix: Record<string, Partial<Record<AgencyWorkspaceRoleKey, AgencyPermissionAccessValue>>> =
      {};

    for (const app of apps) {
      const appKey = typeof app.appKey === 'string' ? app.appKey : null;
      const permissionsByRole = app.permissionsByRole;

      if (
        !appKey ||
        !permissionsByRole ||
        typeof permissionsByRole !== 'object' ||
        Array.isArray(permissionsByRole)
      ) {
        continue;
      }

      matrix[appKey] = {};

      for (const role of AGENCY_WORKSPACE_ROLES) {
        const access = (permissionsByRole as Record<string, unknown>)[role];

        if (this.isPermissionAccess(access)) {
          matrix[appKey][role] = access;
        }
      }
    }

    return matrix;
  }

  private normalizePermissionMatrix(
    matrix: Record<string, Record<string, unknown>>,
  ) {
    const normalized: AgencyPermissionMatrix = {};

    for (const appKey of Object.keys(matrix)) {
      normalized[appKey] = {
        owner: 'full',
        admin: this.isPermissionAccess(matrix[appKey]?.admin)
          ? matrix[appKey].admin
          : 'blocked',
        manager: this.isPermissionAccess(matrix[appKey]?.manager)
          ? matrix[appKey].manager
          : 'blocked',
        member: this.isPermissionAccess(matrix[appKey]?.member)
          ? matrix[appKey].member
          : 'blocked',
      };
    }

    return normalized;
  }

  private hashToken(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }

  private async sendEmailTwoFactorCode(
    tenantId: string,
    userId: string,
    email: string,
  ) {
    const code = String(randomInt(100000, 999999));

    await this.emailTwoFactorRepo.save(
      this.emailTwoFactorRepo.create({
        tenantId,
        userId,
        codeHash: this.hashToken(code),
        purpose: 'setup',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      }),
    );

    const { html, text } = renderTransactionalEmail({
      title: 'Codigo de verificacao',
      intro: 'Use este codigo para ativar o 2FA por e-mail no Lyra Agency.',
      secondaryText: `<strong>Codigo:</strong> ${code}`,
      footerText:
        'Este codigo expira em 5 minutos. Se voce nao solicitou esta alteracao, ignore este e-mail.',
    });

    await this.emailService.sendEmail({
      to: email,
      subject: 'Codigo de verificacao do Lyra Agency',
      html,
      text,
    });
  }

  private async verifyEmailTwoFactorCode(
    tenantId: string,
    userId: string,
    code: string,
  ) {
    const record = await this.emailTwoFactorRepo.findOne({
      where: {
        tenantId,
        userId,
        purpose: 'setup',
      },
      order: { createdAt: 'DESC' },
    });

    if (
      !record ||
      record.usedAt ||
      record.expiresAt.getTime() < Date.now() ||
      record.attempts >= 5
    ) {
      throw new BadRequestException('Invalid or expired two-factor code.');
    }

    if (record.codeHash !== this.hashToken(code.trim())) {
      record.attempts += 1;
      await this.emailTwoFactorRepo.save(record);
      throw new BadRequestException('Invalid or expired two-factor code.');
    }

    record.usedAt = new Date();
    await this.emailTwoFactorRepo.save(record);
  }

  private async getUserSecuritySettings(tenantId: string, userId: string) {
    const entity =
      (await this.userSecurityRepo.findOne({ where: { tenantId, userId } })) ??
      this.userSecurityRepo.create({
        tenantId,
        userId,
        currentEmail: '',
        passwordHash: null,
        passwordUpdatedAt: null,
        twoFactorEnabled: false,
        twoFactorMethod: 'authenticator',
        twoFactorSecretEncrypted: null,
        twoFactorPendingSecretEncrypted: null,
        loginAlertsEnabled: true,
        trustedDevicesEnabled: true,
      });

    return {
      tenantId: entity.tenantId,
      userId: entity.userId,
      currentEmail: entity.currentEmail,
      passwordUpdatedAt: entity.passwordUpdatedAt,
      twoFactorEnabled: entity.twoFactorEnabled,
      twoFactorMethod: entity.twoFactorMethod ?? 'authenticator',
      twoFactorPending: Boolean(entity.twoFactorPendingSecretEncrypted),
      loginAlertsEnabled: entity.loginAlertsEnabled,
      trustedDevicesEnabled: entity.trustedDevicesEnabled,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private async getUserSessions(
    tenantId: string,
    userId: string,
    currentSessionId?: string,
  ) {
    const sessions = await this.userSessionsRepo.find({
      where: {
        tenantId,
        userId,
      },
      order: { updatedAt: 'DESC', createdAt: 'DESC' },
      take: 25,
    });

    return sessions.map((session) => ({
      id: session.id,
      title: session.title,
      browser: session.browser,
      userAgent: this.summarizeUserAgent(session.userAgent),
      ipAddress: session.ipAddress,
      deviceName: session.deviceName,
      location: session.location,
      lastSeen: session.lastSeen,
      status: session.status,
      isCurrent: currentSessionId
        ? session.id === currentSessionId
        : session.status === 'current',
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
    }));
  }

  private async getTrustedDevices(tenantId: string, userId: string) {
    const devices = await this.trustedDevicesRepo.find({
      where: {
        tenantId,
        userId,
        revokedAt: IsNull(),
      },
      order: { lastUsedAt: 'DESC', trustedAt: 'DESC', createdAt: 'DESC' },
      take: 25,
    });

    return devices.map((device) => ({
      id: device.id,
      deviceName: device.deviceName,
      userAgent: this.summarizeUserAgent(device.userAgent),
      ipAddress: device.ipAddress,
      location: device.location,
      trustedAt: device.trustedAt,
      lastUsedAt: device.lastUsedAt,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
    }));
  }

  private summarizeUserAgent(userAgent?: string | null) {
    if (!userAgent) {
      return null;
    }

    return userAgent.replace(/\s+/g, ' ').slice(0, 180);
  }

  private async getWorkspaceNotificationSettings(
    tenantId: string,
    workspaceId: string,
  ) {
    return (
      (await this.workspaceNotificationsRepo.findOne({
        where: { tenantId, workspaceId },
      })) ??
      this.workspaceNotificationsRepo.create({
        tenantId,
        workspaceId,
        quietHours: this.getDefaultQuietHours(),
      })
    );
  }

  private async getUserNotificationPreferences(
    tenantId: string,
    userId: string,
  ) {
    return (
      (await this.userNotificationPreferencesRepo.findOne({
        where: { tenantId, userId },
      })) ??
      this.userNotificationPreferencesRepo.create({
        tenantId,
        userId,
        preferences: this.getDefaultNotificationPreferences(),
      })
    );
  }

  private getDefaultQuietHours() {
    return [
      { key: 'monday', label: 'Segunda', start: '19:00', end: '08:00' },
      { key: 'tuesday', label: 'Terca', start: '19:00', end: '08:00' },
      { key: 'wednesday', label: 'Quarta', start: '19:00', end: '08:00' },
      { key: 'thursday', label: 'Quinta', start: '19:00', end: '08:00' },
      { key: 'friday', label: 'Sexta', start: '18:00', end: '09:00' },
      { key: 'saturday', label: 'Sabado', start: '13:00', end: '10:00' },
      { key: 'sunday', label: 'Domingo', start: '00:00', end: '23:59' },
    ];
  }

  private getDefaultNotificationPreferences() {
    return [
      { key: 'messages', app: true, email: true, push: true },
      { key: 'finance', app: true, email: true, push: false },
      { key: 'tasks', app: true, email: false, push: true },
      { key: 'calendar', app: true, email: true, push: true },
      { key: 'clients', app: true, email: true, push: false },
      { key: 'security', app: true, email: true, push: true },
      { key: 'system', app: true, email: false, push: false },
    ];
  }

  private getDefaultSecurityEmailTemplates() {
    const productName = this.getAgencyProductName();

    return {
      domain: this.getAgencyEmailDomain(),
      productName,
      fromName: this.getAgencySmtpFromName(),
      templates: {
        passwordReset: 'Recuperacao de senha',
        passwordChanged: 'Senha alterada',
        twoFactorCode: 'Codigo de verificacao',
        newLoginAlert: 'Novo login detectado',
        workspaceInvitation: `Convite para o ${productName}`,
      },
    };
  }

  private getAgencyProductName() {
    return process.env.AGENCY_PRODUCT_NAME || 'Lyra Agency';
  }

  private getAgencySmtpFromName() {
    return process.env.AGENCY_SMTP_FROM_NAME || 'Lyra Agency';
  }

  private getAgencyEmailDomain() {
    return process.env.AGENCY_EMAIL_DOMAIN || 'lyrasuite.com';
  }
}
