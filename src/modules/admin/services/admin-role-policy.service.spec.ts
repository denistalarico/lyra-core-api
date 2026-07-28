import { ForbiddenException } from '@nestjs/common';
import type { AdminPrincipal } from '../types/admin-access.types';
import { AdminRolePolicyService } from './admin-role-policy.service';

const principal = (
  roleKey: AdminPrincipal['roleKey'],
  adminId = 'actor',
): AdminPrincipal => ({
  adminId,
  userId: 'user',
  identityTenantId: 'tenant',
  email: 'actor@example.com',
  displayName: 'Actor',
  roleKey,
  permissions: ['admin.access'],
  sessionId: 'session',
  sessionContext: 'admin',
});

describe('AdminRolePolicyService', () => {
  const service = new AdminRolePolicyService();

  it('allows super administrators to grant every catalog role', () => {
    expect(service.grantableRoles(principal('super_admin'))).toEqual([
      'super_admin',
      'admin',
      'support_admin',
      'billing_admin',
      'operations_admin',
      'read_only',
    ]);
  });

  it('limits administrators to specialized and read-only roles', () => {
    const actor = principal('admin');
    expect(service.grantableRoles(actor)).toEqual([
      'support_admin',
      'billing_admin',
      'operations_admin',
      'read_only',
    ]);
    expect(() => service.assertCanGrant(actor, 'super_admin')).toThrow(
      ForbiddenException,
    );
    expect(() => service.assertCanGrant(actor, 'admin')).toThrow(
      ForbiddenException,
    );
  });

  it('protects self-management and higher-authority targets', () => {
    const actor = principal('admin');
    expect(() =>
      service.assertCanManage(actor, {
        id: actor.adminId,
        roleKey: 'read_only',
      }),
    ).toThrow(ForbiddenException);
    expect(() =>
      service.assertCanManage(actor, {
        id: 'target',
        roleKey: 'super_admin',
      }),
    ).toThrow(ForbiddenException);
    expect(() =>
      service.assertCanManage(actor, {
        id: 'target',
        roleKey: 'support_admin',
      }),
    ).not.toThrow();
  });
});
