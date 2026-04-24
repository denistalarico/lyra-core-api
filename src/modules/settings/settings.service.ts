import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PatchUserPreferencesDto } from './dto/patch-user-preferences.dto';
import { PatchWorkspaceAiSettingsDto } from './dto/patch-workspace-ai-settings.dto';
import { PatchWorkspaceCompanySettingsDto } from './dto/patch-workspace-company-settings.dto';
import { UserPreferencesEntity } from './entities/user-preferences.entity';
import { WorkspaceSettingsAiEntity } from './entities/workspace-settings-ai.entity';
import { WorkspaceSettingsCompanyEntity } from './entities/workspace-settings-company.entity';
import { PatchWorkspaceCompanyBrandAssetsDto } from './dto/patch-workspace-company-brand-assets.dto';
import { PatchUserProfileDto } from './dto/patch-user-profile.dto';
import { PatchUserProfileAvatarDto } from './dto/patch-user-profile-avatar.dto';
import { UserProfileEntity } from './entities/user-profile.entity';
import { InviteWorkspaceUserDto } from './dto/invite-workspace-user.dto';
import { PatchWorkspaceUserAccessDto } from './dto/patch-workspace-user-access.dto';
import { WorkspaceUserEntity } from './entities/workspace-user.entity';
import { WorkspaceUserModuleAccessEntity } from './entities/workspace-user-module-access.entity';
import { WorkspaceSettingsEmailEntity } from './entities/workspace-settings-email.entity';
import { PatchWorkspaceEmailSettingsDto } from './dto/patch-workspace-email-settings.dto';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { WorkspaceIntegrationEntity } from './entities/workspace-integration.entity';
import { PatchWorkspaceIntegrationsDto } from './dto/patch-workspace-integrations.dto';
import * as argon2 from 'argon2';
import { generateSecret, generateURI, verify } from 'otplib';
import * as QRCode from 'qrcode';
import { UserSecuritySettingsEntity } from './entities/user-security-settings.entity';
import { UserSessionEntity } from './entities/user-session.entity';
import { UserTrustedDeviceEntity } from './entities/user-trusted-device.entity';
import { PatchSecurityEmailDto } from './dto/patch-security-email.dto';
import { PatchSecurityPasswordDto } from './dto/patch-security-password.dto';
import { ConfirmTwoFactorDto } from './dto/confirm-two-factor.dto';
import { UserNotificationEntity } from './entities/user-notification.entity';

const MODULE_KEYS = [
  'inbox',
  'crm',
  'agents',
  'automations',
  'analytics',
  'social',
  'settings',
] as const;

type WorkspaceRole = 'owner' | 'admin' | 'manager' | 'member';
type ModulePermission = 'admin' | 'manager' | 'member';

function createModulesFromRole(role: WorkspaceRole) {
  if (role === 'owner') {
    return {
      inbox: { enabled: true, permission: 'admin' as ModulePermission },
      crm: { enabled: true, permission: 'admin' as ModulePermission },
      agents: { enabled: true, permission: 'admin' as ModulePermission },
      automations: { enabled: true, permission: 'admin' as ModulePermission },
      analytics: { enabled: true, permission: 'admin' as ModulePermission },
      social: { enabled: true, permission: 'admin' as ModulePermission },
      settings: { enabled: true, permission: 'admin' as ModulePermission },
    };
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

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(UserPreferencesEntity)
    private readonly userPreferencesRepo: Repository<UserPreferencesEntity>,
    @InjectRepository(WorkspaceSettingsAiEntity)
    private readonly aiRepo: Repository<WorkspaceSettingsAiEntity>,
    @InjectRepository(WorkspaceSettingsCompanyEntity)
    private readonly companyRepo: Repository<WorkspaceSettingsCompanyEntity>,
    @InjectRepository(UserProfileEntity)
    private readonly userProfileRepo: Repository<UserProfileEntity>,
    @InjectRepository(WorkspaceUserEntity)
    private readonly workspaceUserRepo: Repository<WorkspaceUserEntity>,
    @InjectRepository(WorkspaceUserModuleAccessEntity)
    private readonly workspaceUserModuleAccessRepo: Repository<WorkspaceUserModuleAccessEntity>,
    @InjectRepository(WorkspaceSettingsEmailEntity)
    private readonly emailRepo: Repository<WorkspaceSettingsEmailEntity>,
    private readonly cryptoService: SettingsCryptoService,
    @InjectRepository(WorkspaceIntegrationEntity)
    private readonly integrationsRepo: Repository<WorkspaceIntegrationEntity>,
    @InjectRepository(UserSecuritySettingsEntity)
    private readonly securityRepo: Repository<UserSecuritySettingsEntity>,
    @InjectRepository(UserSessionEntity)
    private readonly sessionsRepo: Repository<UserSessionEntity>,
    @InjectRepository(UserTrustedDeviceEntity)
    private readonly trustedDevicesRepo: Repository<UserTrustedDeviceEntity>,
    @InjectRepository(UserNotificationEntity)
    private readonly notificationsRepo: Repository<UserNotificationEntity>,
  ) {}

  async getPreferences(tenantId: string, userId: string) {
    const found = await this.userPreferencesRepo.findOne({
      where: { tenantId, userId },
    });

    return (
      found ??
      this.userPreferencesRepo.create({
        tenantId,
        userId,
      })
    );
  }

  async patchPreferences(
    tenantId: string,
    userId: string,
    dto: PatchUserPreferencesDto,
  ) {
    await this.userPreferencesRepo.upsert(
      {
        tenantId,
        userId,
        ...dto,
      },
      ['tenantId', 'userId'],
    );

    return this.getPreferences(tenantId, userId);
  }

  async getAi(tenantId: string, workspaceId: string) {
    const found = await this.aiRepo.findOne({
      where: { tenantId, workspaceId },
    });

    return (
      found ??
      this.aiRepo.create({
        tenantId,
        workspaceId,
      })
    );
  }

  async patchAi(
    tenantId: string,
    workspaceId: string,
    dto: PatchWorkspaceAiSettingsDto,
  ) {
    await this.aiRepo.upsert(
      {
        tenantId,
        workspaceId,
        ...dto,
      },
      ['tenantId', 'workspaceId'],
    );

    return this.getAi(tenantId, workspaceId);
  }

  async getCompany(tenantId: string, workspaceId: string) {
    const found = await this.companyRepo.findOne({
      where: { tenantId, workspaceId },
    });

    return (
      found ??
      this.companyRepo.create({
        tenantId,
        workspaceId,
        legalName: '',
        publicName: '',
        workspaceName: '',
        taxIdType: 'cnpj',
        taxIdCustomLabel: null,
        taxId: '',
        description: null,
        primaryColor: '#2563EB',
        secondaryColor: '#0F172A',
        supportEmail: null,
        phone: null,
        website: null,
        instagramHandle: null,
        facebookUrl: null,
        linkedinUrl: null,
        country: 'Brazil',
        stateRegion: null,
        city: null,
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
        industry: null,
        companySize: null,
        timezone: 'America/Sao_Paulo',
        brandLogoUrl: null,
        brandLogoAssetKey: null,
      })
    );
  }

  async patchCompany(
    tenantId: string,
    workspaceId: string,
    dto: PatchWorkspaceCompanySettingsDto,
  ) {
    await this.companyRepo.upsert(
      {
        tenantId,
        workspaceId,
        ...dto,
        taxIdCustomLabel: dto.taxIdCustomLabel ?? null,
        description: dto.description ?? null,
        supportEmail: dto.supportEmail ?? null,
        phone: dto.phone ?? null,
        website: dto.website ?? null,
        instagramHandle: dto.instagramHandle ?? null,
        facebookUrl: dto.facebookUrl ?? null,
        linkedinUrl: dto.linkedinUrl ?? null,
        stateRegion: dto.stateRegion ?? null,
        city: dto.city ?? null,
        addressLine1: dto.addressLine1 ?? null,
        addressLine2: dto.addressLine2 ?? null,
        postalCode: dto.postalCode ?? null,
        industry: dto.industry ?? null,
        companySize: dto.companySize ?? null,
      },
      ['tenantId', 'workspaceId'],
    );

    return this.getCompany(tenantId, workspaceId);
  }

  async patchCompanyBrandAssets(
    tenantId: string,
    workspaceId: string,
    dto: PatchWorkspaceCompanyBrandAssetsDto,
  ) {
    const existing = await this.companyRepo.findOne({
      where: { tenantId, workspaceId },
    });

    if (!existing) {
      await this.companyRepo.insert({
        tenantId,
        workspaceId,
        legalName: '',
        publicName: '',
        workspaceName: '',
        taxIdType: 'cnpj',
        taxIdCustomLabel: null,
        taxId: '',
        description: null,
        primaryColor: '#2563EB',
        secondaryColor: '#0F172A',
        supportEmail: null,
        phone: null,
        website: null,
        instagramHandle: null,
        facebookUrl: null,
        linkedinUrl: null,
        country: 'Brazil',
        stateRegion: null,
        city: null,
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
        industry: null,
        companySize: null,
        timezone: 'America/Sao_Paulo',
        brandLogoUrl: dto.brandLogoUrl ?? null,
        brandLogoAssetKey: dto.brandLogoAssetKey ?? null,
      });
    } else {
      await this.companyRepo.update(
        { tenantId, workspaceId },
        {
          brandLogoUrl: dto.brandLogoUrl ?? null,
          brandLogoAssetKey: dto.brandLogoAssetKey ?? null,
        },
      );
    }

    return this.getCompany(tenantId, workspaceId);
  }

  async getProfile(tenantId: string, userId: string) {
    const found = await this.userProfileRepo.findOne({
      where: { tenantId, userId },
    });

    return (
      found ??
      this.userProfileRepo.create({
        tenantId,
        userId,
        firstName: '',
        lastName: '',
        displayName: '',
        email: '',
        jobTitle: null,
        bio: null,
        avatarUrl: null,
        avatarAssetKey: null,
      })
    );
  }

  async patchProfile(
    tenantId: string,
    userId: string,
    dto: PatchUserProfileDto,
  ) {
    await this.userProfileRepo.upsert(
      {
        tenantId,
        userId,
        ...dto,
        jobTitle: dto.jobTitle ?? null,
        bio: dto.bio ?? null,
      },
      ['tenantId', 'userId'],
    );

    return this.getProfile(tenantId, userId);
  }

  async patchProfileAvatar(
    tenantId: string,
    userId: string,
    dto: PatchUserProfileAvatarDto,
  ) {
    const existing = await this.userProfileRepo.findOne({
      where: { tenantId, userId },
    });

    if (!existing) {
      await this.userProfileRepo.insert({
        tenantId,
        userId,
        firstName: '',
        lastName: '',
        displayName: '',
        email: '',
        jobTitle: null,
        bio: null,
        avatarUrl: dto.avatarUrl ?? null,
        avatarAssetKey: dto.avatarAssetKey ?? null,
      });
    } else {
      await this.userProfileRepo.update(
        { tenantId, userId },
        {
          avatarUrl: dto.avatarUrl ?? null,
          avatarAssetKey: dto.avatarAssetKey ?? null,
        },
      );
    }

    return this.getProfile(tenantId, userId);
  }

  async getWorkspaceUsers(
    tenantId: string,
    workspaceId: string,
    userId?: string,
  ) {
    let users = await this.workspaceUserRepo.find({
      where: { tenantId, workspaceId },
      order: { createdAt: 'ASC' },
    });

    if (users.length === 0 && userId) {
      const profile = await this.userProfileRepo.findOne({
        where: { tenantId, userId },
      });

      const owner = await this.workspaceUserRepo.save(
        this.workspaceUserRepo.create({
          tenantId,
          workspaceId,
          userId,
          name:
            profile?.displayName ||
            [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') ||
            'Workspace Owner',
          email: profile?.email || 'owner@lyra.local',
          role: 'owner',
          status: 'active',
          lastAccess: 'Hoje',
          invitedAt: null,
          activatedAt: new Date(),
          deactivatedAt: null,
        }),
      );

      const modules = createModulesFromRole('owner');

      await this.workspaceUserModuleAccessRepo.save(
        MODULE_KEYS.map((moduleKey) =>
          this.workspaceUserModuleAccessRepo.create({
            tenantId,
            workspaceId,
            workspaceUserId: owner.id,
            moduleKey,
            enabled: modules[moduleKey].enabled,
            permission: modules[moduleKey].permission,
          }),
        ),
      );

      users = await this.workspaceUserRepo.find({
        where: { tenantId, workspaceId },
        order: { createdAt: 'ASC' },
      });
    }

    const usersWithModules = await Promise.all(
      users.map(async (user) => {
        const accessRows = await this.workspaceUserModuleAccessRepo.find({
          where: {
            tenantId,
            workspaceId,
            workspaceUserId: user.id,
          },
        });

        const modules = Object.fromEntries(
          MODULE_KEYS.map((key) => {
            const found = accessRows.find((row) => row.moduleKey === key);

            return [
              key,
              found
                ? {
                    enabled: found.enabled,
                    permission: found.permission,
                  }
                : {
                    enabled: false,
                    permission: 'member',
                  },
            ];
          }),
        );

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          lastAccess: user.lastAccess,
          modules,
        };
      }),
    );

    return usersWithModules;
  }

  async inviteWorkspaceUser(
    tenantId: string,
    workspaceId: string,
    dto: InviteWorkspaceUserDto,
  ) {
    const inserted = await this.workspaceUserRepo.save(
      this.workspaceUserRepo.create({
        tenantId,
        workspaceId,
        userId: null,
        name: dto.name,
        email: dto.email,
        role: dto.role,
        status: 'invited',
        lastAccess: 'Convite pendente',
        invitedAt: new Date(),
        activatedAt: null,
        deactivatedAt: null,
      }),
    );

    const modules = createModulesFromRole(dto.role);

    await this.workspaceUserModuleAccessRepo.save(
      MODULE_KEYS.map((moduleKey) =>
        this.workspaceUserModuleAccessRepo.create({
          tenantId,
          workspaceId,
          workspaceUserId: inserted.id,
          moduleKey,
          enabled: modules[moduleKey].enabled,
          permission: modules[moduleKey].permission,
        }),
      ),
    );

    return this.getWorkspaceUsers(tenantId, workspaceId);
  }

  async patchWorkspaceUserAccess(
    tenantId: string,
    workspaceId: string,
    workspaceUserId: string,
    dto: PatchWorkspaceUserAccessDto,
  ) {
    const user = await this.workspaceUserRepo.findOne({
      where: { tenantId, workspaceId, id: workspaceUserId },
    });

    if (!user) {
      throw new NotFoundException('Workspace user not found.');
    }

    await this.workspaceUserRepo.update(
      { tenantId, workspaceId, id: workspaceUserId },
      { role: dto.role },
    );

    for (const moduleKey of MODULE_KEYS) {
      const moduleConfig = dto.modules[moduleKey];

      await this.workspaceUserModuleAccessRepo.upsert(
        {
          tenantId,
          workspaceId,
          workspaceUserId,
          moduleKey,
          enabled: moduleConfig.enabled,
          permission: moduleConfig.permission,
        },
        ['workspaceUserId', 'moduleKey'],
      );
    }

    return this.getWorkspaceUsers(tenantId, workspaceId);
  }

  async activateWorkspaceUser(
    tenantId: string,
    workspaceId: string,
    workspaceUserId: string,
  ) {
    await this.workspaceUserRepo.update(
      { tenantId, workspaceId, id: workspaceUserId },
      {
        status: 'active',
        activatedAt: new Date(),
        deactivatedAt: null,
        lastAccess: 'Hoje, 09:12',
      },
    );

    return this.getWorkspaceUsers(tenantId, workspaceId);
  }

  async deactivateWorkspaceUser(
    tenantId: string,
    workspaceId: string,
    workspaceUserId: string,
  ) {
    await this.workspaceUserRepo.update(
      { tenantId, workspaceId, id: workspaceUserId },
      {
        status: 'inactive',
        deactivatedAt: new Date(),
      },
    );

    return this.getWorkspaceUsers(tenantId, workspaceId);
  }

  async removeWorkspaceUser(
    tenantId: string,
    workspaceId: string,
    workspaceUserId: string,
  ) {
    await this.workspaceUserRepo.delete({
      tenantId,
      workspaceId,
      id: workspaceUserId,
    });

    return this.getWorkspaceUsers(tenantId, workspaceId);
  }

  async resetWorkspaceUserPassword(
    tenantId: string,
    workspaceId: string,
    workspaceUserId: string,
  ) {
    const user = await this.workspaceUserRepo.findOne({
      where: { tenantId, workspaceId, id: workspaceUserId },
    });

    if (!user) {
      throw new NotFoundException('Workspace user not found.');
    }

    return {
      success: true,
      workspaceUserId,
      message: `Password reset flow requested for ${user.email}.`,
    };
  }

  async getEmail(tenantId: string, workspaceId: string) {
    const found = await this.emailRepo.findOne({
      where: { tenantId, workspaceId },
    });

    const entity =
      found ??
      this.emailRepo.create({
        tenantId,
        workspaceId,
        notificationEmail: '',
        incomingHost: '',
        incomingPort: '',
        incomingUsername: '',
        incomingPasswordEncrypted: null,
        incomingSecurity: 'ssl_tls',
        incomingServerType: 'imap',
        outgoingHost: '',
        outgoingPort: '',
        outgoingUsername: '',
        outgoingPasswordEncrypted: null,
        outgoingSecurity: 'starttls',
      });

    return {
      notificationEmail: entity.notificationEmail,
      incoming: {
        host: entity.incomingHost,
        port: entity.incomingPort,
        username: entity.incomingUsername,
        password: '',
        security: entity.incomingSecurity,
        serverType: entity.incomingServerType,
      },
      outgoing: {
        host: entity.outgoingHost,
        port: entity.outgoingPort,
        username: entity.outgoingUsername,
        password: '',
        security: entity.outgoingSecurity,
      },
    };
  }

  async patchEmail(
    tenantId: string,
    workspaceId: string,
    dto: PatchWorkspaceEmailSettingsDto,
  ) {
    const existing = await this.emailRepo.findOne({
      where: { tenantId, workspaceId },
    });

    const incomingPasswordEncrypted = dto.incoming.password
      ? this.cryptoService.encrypt(dto.incoming.password)
      : (existing?.incomingPasswordEncrypted ?? null);

    const outgoingPasswordEncrypted = dto.outgoing.password
      ? this.cryptoService.encrypt(dto.outgoing.password)
      : (existing?.outgoingPasswordEncrypted ?? null);

    await this.emailRepo.upsert(
      {
        tenantId,
        workspaceId,
        notificationEmail: dto.notificationEmail ?? '',
        incomingHost: dto.incoming.host,
        incomingPort: dto.incoming.port,
        incomingUsername: dto.incoming.username,
        incomingPasswordEncrypted,
        incomingSecurity: dto.incoming.security,
        incomingServerType: dto.incoming.serverType,
        outgoingHost: dto.outgoing.host,
        outgoingPort: dto.outgoing.port,
        outgoingUsername: dto.outgoing.username,
        outgoingPasswordEncrypted,
        outgoingSecurity: dto.outgoing.security,
      },
      ['tenantId', 'workspaceId'],
    );

    return this.getEmail(tenantId, workspaceId);
  }

  async getIntegrations(tenantId: string, workspaceId: string) {
    return this.integrationsRepo.find({
      where: { tenantId, workspaceId },
      order: {
        category: 'ASC',
        sidebarOrder: 'ASC',
        itemId: 'ASC',
      },
    });
  }

  async patchIntegrations(
    tenantId: string,
    workspaceId: string,
    dto: PatchWorkspaceIntegrationsDto,
  ) {
    for (const item of dto.items) {
      await this.integrationsRepo.upsert(
        {
          tenantId,
          workspaceId,
          itemId: item.itemId,
          category: item.category,
          status: item.status,
          isInstalled: item.isInstalled,
          isPinned: item.isPinned,
          sidebarOrder: item.sidebarOrder ?? null,
        },
        ['workspaceId', 'itemId'],
      );
    }

    return this.getIntegrations(tenantId, workspaceId);
  }

  async getSecurity(tenantId: string, userId: string) {
    const found = await this.securityRepo.findOne({
      where: { tenantId, userId },
    });

    const entity =
      found ??
      this.securityRepo.create({
        tenantId,
        userId,
        currentEmail: '',
        passwordHash: null,
        passwordUpdatedAt: null,
        twoFactorEnabled: false,
        twoFactorSecretEncrypted: null,
        twoFactorPendingSecretEncrypted: null,
        loginAlertsEnabled: true,
        trustedDevicesEnabled: true,
      });

    return {
      currentEmail: entity.currentEmail,
      newEmail: '',
      currentPassword: '',
      newPassword: '',
      confirmNewPassword: '',
      twoFactorEnabled: entity.twoFactorEnabled,
      passwordUpdatedAt: entity.passwordUpdatedAt,
      loginAlertsEnabled: entity.loginAlertsEnabled,
      trustedDevicesEnabled: entity.trustedDevicesEnabled,
    };
  }

  async patchSecurityEmail(
    tenantId: string,
    userId: string,
    dto: PatchSecurityEmailDto,
  ) {
    await this.securityRepo.upsert(
      {
        tenantId,
        userId,
        currentEmail: dto.newEmail,
      },
      ['tenantId', 'userId'],
    );

    return this.getSecurity(tenantId, userId);
  }

  async patchSecurityPassword(
    tenantId: string,
    userId: string,
    dto: PatchSecurityPasswordDto,
  ) {
    const existing = await this.securityRepo.findOne({
      where: { tenantId, userId },
    });

    if (existing?.passwordHash) {
      const isValid = await argon2.verify(
        existing.passwordHash,
        dto.currentPassword,
      );

      if (!isValid) {
        throw new Error('Invalid current password.');
      }
    }

    const passwordHash = await argon2.hash(dto.newPassword);

    await this.securityRepo.upsert(
      {
        tenantId,
        userId,
        passwordHash,
        passwordUpdatedAt: new Date(),
        currentEmail: existing?.currentEmail ?? '',
        twoFactorEnabled: existing?.twoFactorEnabled ?? false,
        twoFactorSecretEncrypted: existing?.twoFactorSecretEncrypted ?? null,
        twoFactorPendingSecretEncrypted:
          existing?.twoFactorPendingSecretEncrypted ?? null,
        loginAlertsEnabled: existing?.loginAlertsEnabled ?? true,
        trustedDevicesEnabled: existing?.trustedDevicesEnabled ?? true,
      },
      ['tenantId', 'userId'],
    );

    return this.getSecurity(tenantId, userId);
  }

  async setupTwoFactor(tenantId: string, userId: string) {
    const secret = generateSecret();
    const encrypted = this.cryptoService.encrypt(secret);

    const otpauth = generateURI({
      issuer: 'Lyra Suite',
      label: userId,
      secret,
    });

    const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

    const existing = await this.securityRepo.findOne({
      where: { tenantId, userId },
    });

    await this.securityRepo.upsert(
      {
        tenantId,
        userId,
        currentEmail: existing?.currentEmail ?? '',
        passwordHash: existing?.passwordHash ?? null,
        passwordUpdatedAt: existing?.passwordUpdatedAt ?? null,
        twoFactorEnabled: existing?.twoFactorEnabled ?? false,
        twoFactorSecretEncrypted: existing?.twoFactorSecretEncrypted ?? null,
        twoFactorPendingSecretEncrypted: encrypted,
        loginAlertsEnabled: existing?.loginAlertsEnabled ?? true,
        trustedDevicesEnabled: existing?.trustedDevicesEnabled ?? true,
      },
      ['tenantId', 'userId'],
    );

    return {
      qrCodeDataUrl,
      otpauth,
    };
  }

  async confirmTwoFactor(
    tenantId: string,
    userId: string,
    dto: ConfirmTwoFactorDto,
  ) {
    const existing = await this.securityRepo.findOne({
      where: { tenantId, userId },
    });

    const pendingSecret = this.cryptoService.decrypt(
      existing?.twoFactorPendingSecretEncrypted,
    );

    if (!pendingSecret) {
      throw new Error('No pending two-factor setup.');
    }

    const verification = await verify({
      token: dto.code,
      secret: pendingSecret,
    });
    const isValid = verification.valid;

    if (!isValid) {
      throw new Error('Invalid two-factor code.');
    }

    await this.securityRepo.update(
      { tenantId, userId },
      {
        twoFactorEnabled: true,
        twoFactorSecretEncrypted:
          existing?.twoFactorPendingSecretEncrypted ?? null,
        twoFactorPendingSecretEncrypted: null,
      },
    );

    return this.getSecurity(tenantId, userId);
  }

  async disableTwoFactor(tenantId: string, userId: string) {
    await this.securityRepo.update(
      { tenantId, userId },
      {
        twoFactorEnabled: false,
        twoFactorSecretEncrypted: null,
        twoFactorPendingSecretEncrypted: null,
      },
    );

    return this.getSecurity(tenantId, userId);
  }

  async getSecuritySessions(tenantId: string, userId: string) {
    const existing = await this.sessionsRepo.find({
      where: { tenantId, userId },
      order: { createdAt: 'ASC' },
    });

    if (existing.length === 0) {
      await this.sessionsRepo.save([
        this.sessionsRepo.create({
          tenantId,
          userId,
          sessionTokenHash: null,
          title: 'Sessão atual',
          browser: 'Chrome · Windows',
          location: 'Franca, SP',
          lastSeen: 'Agora mesmo',
          status: 'current',
          revokedAt: null,
          expiresAt: null,
        }),
      ]);
    }

    return this.sessionsRepo.find({
      where: { tenantId, userId },
      order: { createdAt: 'ASC' },
    });
  }

  async revokeSecuritySession(
    tenantId: string,
    userId: string,
    sessionId: string,
  ) {
    await this.sessionsRepo.update(
      { tenantId, userId, id: sessionId },
      {
        status: 'expired',
        revokedAt: new Date(),
      },
    );

    return this.getSecuritySessions(tenantId, userId);
  }

  async revokeOtherSecuritySessions(tenantId: string, userId: string) {
    const sessions = await this.sessionsRepo.find({
      where: { tenantId, userId },
    });

    for (const session of sessions) {
      if (session.status !== 'current') {
        await this.sessionsRepo.update(
          { id: session.id },
          {
            status: 'expired',
            revokedAt: new Date(),
          },
        );
      }
    }

    return this.getSecuritySessions(tenantId, userId);
  }

  async getTrustedDevices(tenantId: string, userId: string) {
    const existing = await this.trustedDevicesRepo.find({
      where: { tenantId, userId },
      order: { createdAt: 'ASC' },
    });

    if (existing.length === 0) {
      await this.trustedDevicesRepo.save([
        this.trustedDevicesRepo.create({
          tenantId,
          userId,
          name: 'Dell Inspiron',
          browser: 'Chrome',
          location: 'Franca, SP',
          lastSeen: 'Agora mesmo',
          status: 'trusted',
          trustedAt: new Date(),
          removedAt: null,
        }),
      ]);
    }

    return this.trustedDevicesRepo.find({
      where: { tenantId, userId },
      order: { createdAt: 'ASC' },
    });
  }

  async trustDevice(tenantId: string, userId: string, deviceId: string) {
    await this.trustedDevicesRepo.update(
      { tenantId, userId, id: deviceId },
      {
        status: 'trusted',
        trustedAt: new Date(),
        removedAt: null,
      },
    );

    return this.getTrustedDevices(tenantId, userId);
  }

  async removeTrustedDevice(
    tenantId: string,
    userId: string,
    deviceId: string,
  ) {
    await this.trustedDevicesRepo.update(
      { tenantId, userId, id: deviceId },
      {
        status: 'inactive',
        removedAt: new Date(),
      },
    );

    return this.getTrustedDevices(tenantId, userId);
  }

  async getNotifications(tenantId: string, userId: string) {
    return this.notificationsRepo.find({
      where: { tenantId, userId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  async markNotificationAsRead(
    tenantId: string,
    userId: string,
    notificationId: string,
  ) {
    await this.notificationsRepo.update(
      { tenantId, userId, id: notificationId },
      {
        isRead: true,
        readAt: new Date(),
      },
    );

    return this.getNotifications(tenantId, userId);
  }

  async markAllNotificationsAsRead(tenantId: string, userId: string) {
    await this.notificationsRepo.update(
      { tenantId, userId, isRead: false },
      {
        isRead: true,
        readAt: new Date(),
      },
    );

    return this.getNotifications(tenantId, userId);
  }
}
