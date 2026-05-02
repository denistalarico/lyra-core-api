import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
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
import { WorkspaceUserInvitationEntity } from './entities/workspace-user-invitation.entity';
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
import { PatchSecuritySettingsDto } from './dto/patch-security-settings.dto';
import {
  ConfirmTwoFactorDto,
  SetupTwoFactorDto,
} from './dto/confirm-two-factor.dto';
import { UserNotificationEntity } from './entities/user-notification.entity';
import { AuthService } from '../auth/auth.service';
import { FilesService } from '../../common/files/files.service';
import { EmailService } from '../email/email.service';

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
type LegacyTrustedDevice = {
  id: string;
  name: string;
  browser: string;
  location: string;
  lastSeen: string;
  status: 'trusted';
};

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
    @InjectRepository(WorkspaceUserInvitationEntity)
    private readonly workspaceUserInvitationRepo: Repository<WorkspaceUserInvitationEntity>,
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
    private readonly authService: AuthService,
    private readonly filesService: FilesService,
    private readonly configService: ConfigService,
    private readonly transactionalEmailService: EmailService,
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
        logoUrl: null,
        logoPath: null,
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
      select: {
        id: true,
        tenantId: true,
        userId: true,
        firstName: true,
        lastName: true,
        displayName: true,
        email: true,
        jobTitle: true,
        bio: true,
        avatarUrl: true,
        avatarAssetKey: true,
        createdAt: true,
        updatedAt: true,
      },
      where: { tenantId, userId },
    });

    if (found) {
      return {
        ...found,
        avatarPath: found.avatarAssetKey ?? null,
      };
    }

    return this.userProfileRepo.create({
      tenantId,
      userId,
      firstName: '',
      lastName: '',
      displayName: '',
      email: '',
      jobTitle: null,
      bio: null,
      avatarUrl: null,
      avatarPath: null,
      avatarAssetKey: null,
    });
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

  async uploadProfileAvatar(
    tenantId: string,
    userId: string,
    file: Express.Multer.File,
  ) {
    const stored = await this.filesService.uploadImageAsset({
      file,
      path: `tenants/${tenantId}/users/${userId}/avatar-${Date.now()}.webp`,
      maxDimension: 512,
    });

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
        avatarUrl: stored.url,
        avatarAssetKey: stored.path,
      });
    } else {
      await this.userProfileRepo.update(
        { tenantId, userId },
        {
          avatarUrl: stored.url,
          avatarAssetKey: stored.path,
        },
      );
    }

    return {
      avatarUrl: stored.url,
      avatarPath: stored.path,
    };
  }

  async uploadCompanyLogo(
    tenantId: string,
    workspaceId: string,
    file: Express.Multer.File,
  ) {
    const stored = await this.filesService.uploadImageAsset({
      file,
      path: `tenants/${tenantId}/company/logo-${Date.now()}.webp`,
      maxDimension: 1024,
    });

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
        logoUrl: stored.url,
        logoPath: stored.path,
      });
    } else {
      await this.companyRepo.update(
        { tenantId, workspaceId },
        {
          logoUrl: stored.url,
          logoPath: stored.path,
        },
      );
    }

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
      path: `tenants/${tenantId}/company/avatar-${Date.now()}.webp`,
      maxDimension: 512,
    });

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
        brandLogoUrl: stored.url,
        brandLogoAssetKey: stored.path,
      });
    } else {
      await this.companyRepo.update(
        { tenantId, workspaceId },
        {
          brandLogoUrl: stored.url,
          brandLogoAssetKey: stored.path,
        },
      );
    }

    return {
      avatarUrl: stored.url,
      avatarPath: stored.path,
    };
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
    invitedByUserId: string,
    actorRole: string | undefined,
    dto: InviteWorkspaceUserDto,
  ) {
    await this.createWorkspaceUserInvitation(
      tenantId,
      workspaceId,
      invitedByUserId,
      actorRole,
      dto,
    );

    return this.getWorkspaceUsers(tenantId, workspaceId);
  }

  async createWorkspaceUserInvitation(
    tenantId: string,
    workspaceId: string,
    invitedByUserId: string,
    actorRole: string | undefined,
    dto: InviteWorkspaceUserDto,
  ) {
    await this.assertCanManageWorkspaceUsers(
      tenantId,
      workspaceId,
      invitedByUserId,
      actorRole,
    );

    const normalizedEmail = dto.email.trim().toLowerCase();

    const existingWorkspaceUser = await this.workspaceUserRepo
      .createQueryBuilder('workspaceUser')
      .where('workspaceUser.tenantId = :tenantId', { tenantId })
      .andWhere('workspaceUser.workspaceId = :workspaceId', { workspaceId })
      .andWhere('lower(workspaceUser.email) = :email', {
        email: normalizedEmail,
      })
      .getOne();

    if (existingWorkspaceUser) {
      throw new ConflictException(
        'This email already belongs to this workspace.',
      );
    }

    const existingPendingInvitation = await this.workspaceUserInvitationRepo
      .createQueryBuilder('invitation')
      .where('invitation.tenantId = :tenantId', { tenantId })
      .andWhere('invitation.workspaceId = :workspaceId', { workspaceId })
      .andWhere('lower(invitation.email) = :email', { email: normalizedEmail })
      .andWhere('invitation.status = :status', { status: 'pending' })
      .andWhere('invitation.revokedAt IS NULL')
      .andWhere('invitation.acceptedAt IS NULL')
      .getOne();

    if (existingPendingInvitation) {
      throw new ConflictException(
        'There is already a pending invitation for this email.',
      );
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invitation = await this.workspaceUserInvitationRepo.save(
      this.workspaceUserInvitationRepo.create({
        tenantId,
        workspaceId,
        email: normalizedEmail,
        role: dto.role,
        status: 'pending',
        tokenHash,
        expiresAt,
        acceptedAt: null,
        revokedAt: null,
        invitedByUserId,
      }),
    );

    const company = await this.getCompany(tenantId, workspaceId);
    const workspaceName =
      company.publicName || company.workspaceName || company.legalName || 'Lyra Suite';
    const frontendUrl =
      this.configService.get<string>('FRONTEND_APP_URL') ??
      this.configService.get<string>('APP_FRONTEND_URL') ??
      'http://82.29.61.35:3001';
    const inviteUrl = `${frontendUrl.replace(/\/$/, '')}/invite/${token}`;

    await this.transactionalEmailService.sendWorkspaceInvitationEmail({
      to: normalizedEmail,
      workspaceName,
      role: dto.role,
      inviteUrl,
      expiresInDays: 7,
    });

    return this.serializeInvitation(invitation);
  }

  async listWorkspaceUserInvitations(
    tenantId: string,
    workspaceId: string,
    actorUserId: string,
    actorRole: string | undefined,
  ) {
    await this.assertCanManageWorkspaceUsers(
      tenantId,
      workspaceId,
      actorUserId,
      actorRole,
    );

    const invitations = await this.workspaceUserInvitationRepo.find({
      where: { tenantId, workspaceId },
      order: { createdAt: 'DESC' },
    });

    return invitations.map((invitation) => this.serializeInvitation(invitation));
  }

  async revokeWorkspaceUserInvitation(
    tenantId: string,
    workspaceId: string,
    actorUserId: string,
    actorRole: string | undefined,
    invitationId: string,
  ) {
    await this.assertCanManageWorkspaceUsers(
      tenantId,
      workspaceId,
      actorUserId,
      actorRole,
    );

    const invitation = await this.workspaceUserInvitationRepo.findOne({
      where: {
        tenantId,
        workspaceId,
        id: invitationId,
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found.');
    }

    if (invitation.status !== 'pending' || invitation.revokedAt) {
      return this.serializeInvitation(invitation);
    }

    invitation.status = 'revoked';
    invitation.revokedAt = new Date();

    return this.serializeInvitation(
      await this.workspaceUserInvitationRepo.save(invitation),
    );
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
        twoFactorMethod: 'authenticator',
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
      twoFactorMethod: entity.twoFactorMethod ?? 'authenticator',
      passwordUpdatedAt: entity.passwordUpdatedAt,
      loginAlertsEnabled: entity.loginAlertsEnabled,
      trustedDevicesEnabled: entity.trustedDevicesEnabled,
    };
  }

  async patchSecurity(
    tenantId: string,
    userId: string,
    dto: PatchSecuritySettingsDto,
  ) {
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

    return this.getSecurity(tenantId, userId);
  }

  async patchSecurityEmail(
    tenantId: string,
    userId: string,
    dto: PatchSecurityEmailDto,
  ) {
    const existing = await this.securityRepo.findOne({
      where: { tenantId, userId },
    });

    await this.securityRepo.upsert(
      {
        tenantId,
        userId,
        currentEmail: dto.newEmail,
      },
      ['tenantId', 'userId'],
    );

    const notificationEmails = [existing?.currentEmail, dto.newEmail].filter(
      (email, index, emails): email is string => {
        return Boolean(email) && emails.indexOf(email) === index;
      },
    );

    await Promise.all(
      notificationEmails.map((email) =>
        this.authService.sendEmailChangedEmail(email),
      ),
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
        twoFactorMethod: existing?.twoFactorMethod ?? 'authenticator',
        twoFactorSecretEncrypted: existing?.twoFactorSecretEncrypted ?? null,
        twoFactorPendingSecretEncrypted:
          existing?.twoFactorPendingSecretEncrypted ?? null,
        loginAlertsEnabled: existing?.loginAlertsEnabled ?? true,
        trustedDevicesEnabled: existing?.trustedDevicesEnabled ?? true,
      },
      ['tenantId', 'userId'],
    );

    await this.authService.sendPasswordChangedEmail(
      existing?.currentEmail ?? '',
    );

    return this.getSecurity(tenantId, userId);
  }

  async requestSecurityPasswordReset(tenantId: string, userId: string) {
    return this.authService.forgotPasswordForUser(tenantId, userId);
  }

  async setupTwoFactor(
    tenantId: string,
    userId: string,
    dto: SetupTwoFactorDto,
  ) {
    const existing = await this.securityRepo.findOne({
      where: { tenantId, userId },
    });

    if (dto.method === 'email') {
      const email = existing?.currentEmail;

      if (!email) {
        throw new Error('No email configured for two-factor setup.');
      }

      await this.authService.sendTwoFactorSetupEmail(tenantId, userId, email);

      return {
        method: 'email' as const,
        email,
      };
    }

    const secret = generateSecret();
    const encrypted = this.cryptoService.encrypt(secret);

    const otpauth = generateURI({
      issuer: 'Lyra Suite',
      label: userId,
      secret,
    });

    const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

    await this.securityRepo.upsert(
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
    dto: ConfirmTwoFactorDto,
  ) {
    const method = dto.method ?? 'authenticator';
    const existing = await this.securityRepo.findOne({
      where: { tenantId, userId },
    });

    if (method === 'email') {
      await this.authService.verifyEmailTwoFactorCode(
        tenantId,
        userId,
        dto.code,
        'setup',
      );

      await this.securityRepo.update(
        { tenantId, userId },
        {
          twoFactorEnabled: true,
          twoFactorMethod: 'email',
          twoFactorSecretEncrypted: null,
          twoFactorPendingSecretEncrypted: null,
        },
      );

      await this.authService.sendTwoFactorEnabledEmail(
        existing?.currentEmail ?? '',
      );

      return this.getSecurity(tenantId, userId);
    }

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
        twoFactorMethod: 'authenticator',
        twoFactorSecretEncrypted:
          existing?.twoFactorPendingSecretEncrypted ?? null,
        twoFactorPendingSecretEncrypted: null,
      },
    );

    await this.authService.sendTwoFactorEnabledEmail(
      existing?.currentEmail ?? '',
    );

    return this.getSecurity(tenantId, userId);
  }

  async disableTwoFactor(tenantId: string, userId: string) {
    const existing = await this.securityRepo.findOne({
      where: { tenantId, userId },
    });

    await this.securityRepo.update(
      { tenantId, userId },
      {
        twoFactorEnabled: false,
        twoFactorMethod: 'authenticator',
        twoFactorSecretEncrypted: null,
        twoFactorPendingSecretEncrypted: null,
      },
    );

    await this.authService.sendTwoFactorDisabledEmail(
      existing?.currentEmail ?? '',
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
      where: {
        tenantId,
        userId,
        status: Not('expired'),
      },
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
      if (session.status === 'active') {
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
    return this.trustedDevicesRepo.find({
      where: {
        tenantId,
        userId,
        deviceFingerprint: Not(IsNull()),
        revokedAt: IsNull(),
      },
      order: { lastUsedAt: 'DESC', trustedAt: 'DESC', createdAt: 'DESC' },
    });
  }

  async getLegacyTrustedDevices(tenantId: string, userId: string) {
    const devices = await this.getTrustedDevices(tenantId, userId);

    return devices.map((device) => this.serializeLegacyTrustedDevice(device));
  }

  async findActiveTrustedDevice(
    tenantId: string,
    userId: string,
    deviceFingerprint: string,
  ) {
    return this.trustedDevicesRepo.findOne({
      where: {
        tenantId,
        userId,
        deviceFingerprint,
        revokedAt: IsNull(),
      },
    });
  }

  async trustCurrentDevice(
    tenantId: string,
    userId: string,
    sessionId: string,
  ) {
    const session = await this.sessionsRepo.findOne({
      where: {
        tenantId,
        userId,
        id: sessionId,
        revokedAt: IsNull(),
      },
    });

    if (!session || session.status === 'expired') {
      throw new NotFoundException('Current session not found.');
    }

    if (!session.deviceFingerprint) {
      throw new BadRequestException(
        'Current session has no device fingerprint.',
      );
    }

    const now = new Date();
    const existing = await this.findActiveTrustedDevice(
      tenantId,
      userId,
      session.deviceFingerprint,
    );

    const device = existing ?? this.trustedDevicesRepo.create();

    device.tenantId = tenantId;
    device.userId = userId;
    device.deviceFingerprint = session.deviceFingerprint;
    device.deviceName = session.deviceName;
    device.userAgent = session.userAgent;
    device.ipAddress = session.ipAddress;
    device.location = session.location;
    device.trustedAt = existing?.trustedAt ?? now;
    device.lastUsedAt = now;
    device.revokedAt = null;

    await this.trustedDevicesRepo.save(device);

    return this.getTrustedDevices(tenantId, userId);
  }

  async trustLegacyDevice(tenantId: string, userId: string, deviceId: string) {
    const device = await this.trustedDevicesRepo.findOne({
      where: {
        tenantId,
        userId,
        id: deviceId,
        deviceFingerprint: Not(IsNull()),
      },
    });

    if (!device) {
      throw new NotFoundException('Trusted device not found.');
    }

    const now = new Date();
    device.trustedAt = device.trustedAt ?? now;
    device.lastUsedAt = now;
    device.revokedAt = null;

    await this.trustedDevicesRepo.save(device);

    return this.getLegacyTrustedDevices(tenantId, userId);
  }

  async revokeTrustedDevice(
    tenantId: string,
    userId: string,
    deviceId: string,
  ) {
    const device = await this.trustedDevicesRepo.findOne({
      where: {
        tenantId,
        userId,
        id: deviceId,
        revokedAt: IsNull(),
      },
    });

    if (!device) {
      throw new NotFoundException('Trusted device not found.');
    }

    device.revokedAt = new Date();
    await this.trustedDevicesRepo.save(device);

    return { success: true };
  }

  private serializeLegacyTrustedDevice(
    device: UserTrustedDeviceEntity,
  ): LegacyTrustedDevice {
    const lastSeen = device.lastUsedAt ?? device.trustedAt ?? device.createdAt;
    const deviceName = device.deviceName ?? 'Dispositivo desconhecido';

    return {
      id: device.id,
      name: deviceName,
      browser: deviceName,
      location: device.location ?? '',
      lastSeen: lastSeen.toISOString(),
      status: 'trusted',
    };
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

  private async assertCanManageWorkspaceUsers(
    tenantId: string,
    workspaceId: string,
    actorUserId: string,
    _actorRole: string | undefined,
  ) {
    const actorMembership = await this.workspaceUserRepo.findOne({
      where: {
        tenantId,
        workspaceId,
        userId: actorUserId,
        status: 'active',
      },
    });

    if (
      !actorMembership ||
      !['owner', 'admin', 'administrator'].includes(actorMembership.role)
    ) {
      throw new ForbiddenException(
        'Only workspace administrators can manage invitations.',
      );
    }
  }

  private serializeInvitation(invitation: WorkspaceUserInvitationEntity) {
    return {
      id: invitation.id,
      tenantId: invitation.tenantId,
      workspaceId: invitation.workspaceId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      revokedAt: invitation.revokedAt,
      invitedByUserId: invitation.invitedByUserId,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
