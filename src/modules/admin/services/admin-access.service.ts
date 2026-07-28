import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminIdentityGateway } from '../contracts/admin-identity.gateway';
import { PlatformInternalAdminEntity } from '../entities';
import {
  type AdminPrincipal,
  type PlatformAdminPermission,
  PLATFORM_ADMIN_ROLE_PERMISSIONS,
  isPlatformAdminPermission,
  isPlatformAdminRoleKey,
} from '../types/admin-access.types';

const AGENCY_CONNECTION = 'agency';

@Injectable()
export class AdminAccessService {
  constructor(
    @InjectRepository(PlatformInternalAdminEntity, AGENCY_CONNECTION)
    private readonly adminRepository: Repository<PlatformInternalAdminEntity>,
    private readonly identityGateway: AdminIdentityGateway,
  ) {}

  isStatusAllowed(status: unknown): boolean {
    return status === 'active';
  }

  permissionsForRole(roleKey: unknown): readonly PlatformAdminPermission[] {
    if (!isPlatformAdminRoleKey(roleKey)) {
      return [];
    }

    return PLATFORM_ADMIN_ROLE_PERMISSIONS[roleKey];
  }

  hasAllPermissions(
    permissions: readonly unknown[],
    required: readonly PlatformAdminPermission[],
  ): boolean {
    if (
      !permissions.every(isPlatformAdminPermission) ||
      !permissions.includes('admin.access')
    ) {
      return false;
    }

    return required.every((permission) => permissions.includes(permission));
  }

  async resolvePrincipal(
    adminId: string,
    sessionId: string,
  ): Promise<AdminPrincipal | null> {
    const admin = await this.adminRepository.findOne({
      where: { id: adminId },
    });

    if (
      !admin ||
      !this.isStatusAllowed(admin.status) ||
      !isPlatformAdminRoleKey(admin.roleKey)
    ) {
      return null;
    }

    const identity = await this.identityGateway.findByIdentity(
      admin.identityTenantId,
      admin.userId,
    );
    if (!identity || identity.status !== 'active') {
      return null;
    }

    const permissions = this.permissionsForRole(admin.roleKey);
    if (!permissions.includes('admin.access')) {
      return null;
    }

    return {
      adminId: admin.id,
      userId: identity.userId,
      identityTenantId: identity.tenantId,
      email: identity.email,
      displayName: identity.displayName,
      roleKey: admin.roleKey,
      permissions,
      sessionId,
      sessionContext: 'admin',
    };
  }
}
