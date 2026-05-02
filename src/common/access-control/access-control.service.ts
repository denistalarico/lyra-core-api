import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceUserEntity } from '../../modules/settings/entities/workspace-user.entity';

export type WorkspaceRole = 'owner' | 'administrator' | 'manager' | 'member';
export type ModuleKey = 'inbox' | 'crm' | 'agents' | 'settings';
export type SettingsSectionKey =
  | 'profile'
  | 'preferences'
  | 'security'
  | 'notifications'
  | 'company'
  | 'ai'
  | 'email'
  | 'users'
  | 'integrations'
  | 'subscription';

const modulePermissions: Record<ModuleKey, WorkspaceRole[]> = {
  inbox: ['owner', 'administrator', 'manager', 'member'],
  crm: ['owner', 'administrator', 'manager', 'member'],
  agents: ['owner', 'administrator', 'manager'],
  settings: ['owner', 'administrator', 'manager', 'member'],
};

const settingsSectionPermissions: Record<SettingsSectionKey, WorkspaceRole[]> =
  {
    profile: ['owner', 'administrator', 'manager', 'member'],
    preferences: ['owner', 'administrator', 'manager', 'member'],
    security: ['owner', 'administrator', 'manager', 'member'],
    notifications: ['owner', 'administrator', 'manager', 'member'],
    company: ['owner', 'administrator'],
    ai: ['owner', 'administrator', 'manager'],
    email: ['owner', 'administrator'],
    users: ['owner', 'administrator'],
    integrations: ['owner', 'administrator', 'manager'],
    subscription: ['owner'],
  };

@Injectable()
export class AccessControlService {
  constructor(
    @InjectRepository(WorkspaceUserEntity)
    private readonly workspaceUsersRepository: Repository<WorkspaceUserEntity>,
  ) {}

  async getWorkspaceRole(
    userId: string,
    tenantId: string,
    workspaceId: string,
  ): Promise<WorkspaceRole> {
    const membership = await this.workspaceUsersRepository.findOne({
      where: {
        tenantId,
        workspaceId,
        userId,
        status: 'active',
      },
      order: { updatedAt: 'DESC' },
    });

    if (!membership) {
      throw new ForbiddenException(
        'You do not have active access to this workspace.',
      );
    }

    return this.normalizeRole(membership.role);
  }

  async canAccessModule(
    userId: string,
    tenantId: string,
    workspaceId: string,
    moduleKey: ModuleKey,
  ) {
    const role = await this.getWorkspaceRole(userId, tenantId, workspaceId);

    return modulePermissions[moduleKey].includes(role);
  }

  async canAccessSettingsSection(
    userId: string,
    tenantId: string,
    workspaceId: string,
    sectionKey: SettingsSectionKey,
  ) {
    const role = await this.getWorkspaceRole(userId, tenantId, workspaceId);

    return settingsSectionPermissions[sectionKey].includes(role);
  }

  async assertCanAccessModule(
    userId: string,
    tenantId: string,
    workspaceId: string,
    moduleKey: ModuleKey,
  ) {
    const allowed = await this.canAccessModule(
      userId,
      tenantId,
      workspaceId,
      moduleKey,
    );

    if (!allowed) {
      throw new ForbiddenException(
        `You do not have permission to access the ${moduleKey} module.`,
      );
    }
  }

  async assertCanAccessSettingsSection(
    userId: string,
    tenantId: string,
    workspaceId: string,
    sectionKey: SettingsSectionKey,
  ) {
    const allowed = await this.canAccessSettingsSection(
      userId,
      tenantId,
      workspaceId,
      sectionKey,
    );

    if (!allowed) {
      throw new ForbiddenException(
        `You do not have permission to access settings/${sectionKey}.`,
      );
    }
  }

  async assertCanManageUsers(
    userId: string,
    tenantId: string,
    workspaceId: string,
  ) {
    return this.assertCanAccessSettingsSection(
      userId,
      tenantId,
      workspaceId,
      'users',
    );
  }

  async assertCanManageSubscription(
    userId: string,
    tenantId: string,
    workspaceId: string,
  ) {
    return this.assertCanAccessSettingsSection(
      userId,
      tenantId,
      workspaceId,
      'subscription',
    );
  }

  async getAccessContext(
    userId: string,
    tenantId: string,
    workspaceId: string,
  ) {
    const role = await this.getWorkspaceRole(userId, tenantId, workspaceId);

    return {
      role,
      allowedModules: this.getAllowedModulesForRole(role),
      allowedSettingsSections: this.getAllowedSettingsSectionsForRole(role),
    };
  }

  getAllowedModulesForRole(role: WorkspaceRole): ModuleKey[] {
    return (Object.keys(modulePermissions) as ModuleKey[]).filter((moduleKey) =>
      modulePermissions[moduleKey].includes(role),
    );
  }

  getAllowedSettingsSectionsForRole(role: WorkspaceRole): SettingsSectionKey[] {
    return (Object.keys(settingsSectionPermissions) as SettingsSectionKey[]).filter(
      (sectionKey) => settingsSectionPermissions[sectionKey].includes(role),
    );
  }

  private normalizeRole(role: string): WorkspaceRole {
    if (role === 'owner') return 'owner';
    if (role === 'admin' || role === 'administrator') return 'administrator';
    if (role === 'manager') return 'manager';
    return 'member';
  }
}
