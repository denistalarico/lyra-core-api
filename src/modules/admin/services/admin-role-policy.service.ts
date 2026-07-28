import { ForbiddenException, Injectable } from '@nestjs/common';
import type {
  AdminPrincipal,
  PlatformAdminRoleKey,
} from '../types/admin-access.types';

const ADMIN_GRANTABLE_ROLES: readonly PlatformAdminRoleKey[] = [
  'support_admin',
  'billing_admin',
  'operations_admin',
  'read_only',
];

@Injectable()
export class AdminRolePolicyService {
  grantableRoles(actor: AdminPrincipal): readonly PlatformAdminRoleKey[] {
    if (actor.roleKey === 'super_admin') {
      return [
        'super_admin',
        'admin',
        'support_admin',
        'billing_admin',
        'operations_admin',
        'read_only',
      ];
    }
    return actor.roleKey === 'admin' ? ADMIN_GRANTABLE_ROLES : [];
  }

  assertCanGrant(actor: AdminPrincipal, role: PlatformAdminRoleKey): void {
    if (!this.grantableRoles(actor).includes(role)) {
      throw new ForbiddenException(
        'You are not allowed to grant the requested administrative role.',
      );
    }
  }

  assertCanManage(
    actor: AdminPrincipal,
    target: { id: string; roleKey: PlatformAdminRoleKey },
  ): void {
    if (actor.adminId === target.id) {
      throw new ForbiddenException(
        'Administrative users cannot manage their own role or status.',
      );
    }
    if (actor.roleKey === 'super_admin') {
      return;
    }
    if (
      actor.roleKey !== 'admin' ||
      target.roleKey === 'super_admin' ||
      target.roleKey === 'admin'
    ) {
      throw new ForbiddenException(
        'The target administrator is outside your management authority.',
      );
    }
  }
}
