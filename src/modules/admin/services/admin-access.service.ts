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
import { adminIdentityReference } from '../utils/admin-identity.util';

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

    const reference = adminIdentityReference(admin);
    if (!reference) return null;
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
      return null;
    }

    const permissions = this.permissionsForRole(admin.roleKey);
    if (!permissions.includes('admin.access')) {
      return null;
    }

    return {
      adminId: admin.id,
      userId: reference.source === 'agency' ? reference.userId : null,
      identityTenantId:
        reference.source === 'agency' ? reference.tenantId : null,
      platformAdminIdentityId:
        reference.source === 'platform_admin' ? reference.identityId : null,
      identitySource: reference.source,
      subjectId: identity.subjectId,
      email: identity.email,
      displayName: identity.displayName,
      roleKey: admin.roleKey,
      permissions,
      sessionId,
      sessionContext: 'admin',
    };
  }
}
