import type { Repository } from 'typeorm';
import {
  AdminIdentityGateway,
  type AdminIdentityRecord,
} from '../contracts/admin-identity.gateway';
import { PlatformInternalAdminEntity } from '../entities';
import {
  PLATFORM_ADMIN_PERMISSIONS,
  PLATFORM_ADMIN_ROLE_KEYS,
  PLATFORM_ADMIN_STATUSES,
} from '../types/admin-access.types';
import { AdminAccessService } from './admin-access.service';

const identity: AdminIdentityRecord = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  email: 'admin@example.com',
  displayName: 'Platform Admin',
  status: 'active',
  passwordConfigured: true,
  twoFactorEnabled: true,
  twoFactorMethod: 'authenticator',
};

function createService(admin?: Partial<PlatformInternalAdminEntity>) {
  const adminRepository = {
    findOne: jest.fn().mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      identityTenantId: identity.tenantId,
      userId: identity.userId,
      status: 'active',
      roleKey: 'admin',
      ...admin,
    }),
  };
  const identityGateway = {
    findByIdentity: jest.fn().mockResolvedValue(identity),
  };

  return new AdminAccessService(
    adminRepository as unknown as Repository<PlatformInternalAdminEntity>,
    identityGateway as unknown as AdminIdentityGateway,
  );
}

describe('AdminAccessService', () => {
  it('denies every administrative status except active', () => {
    const service = createService();

    expect(
      Object.fromEntries(
        PLATFORM_ADMIN_STATUSES.map((status) => [
          status,
          service.isStatusAllowed(status),
        ]),
      ),
    ).toEqual({
      pending: false,
      active: true,
      suspended: false,
      disabled: false,
    });
  });

  it('implements the fail-closed role matrix', () => {
    const service = createService();

    expect(service.permissionsForRole('super_admin')).toEqual(
      PLATFORM_ADMIN_PERMISSIONS,
    );
    expect(service.permissionsForRole('admin')).not.toContain(
      'admin.roles.manage',
    );
    expect(service.permissionsForRole('admin')).not.toContain(
      'admin.security.manage',
    );
    expect(service.permissionsForRole('support_admin')).toEqual([
      'admin.access',
      'admin.settings.read',
      'admin.internal_users.read',
    ]);
    expect(service.permissionsForRole('billing_admin')).toEqual([
      'admin.access',
      'admin.settings.read',
      'admin.internal_users.read',
    ]);
    expect(service.permissionsForRole('operations_admin')).toContain(
      'admin.audit.read',
    );
    expect(
      service
        .permissionsForRole('read_only')
        .every(
          (permission) =>
            permission === 'admin.access' || permission.endsWith('.read'),
        ),
    ).toBe(true);
    expect(service.permissionsForRole('unknown_role')).toEqual([]);

    for (const role of PLATFORM_ADMIN_ROLE_KEYS) {
      expect(service.permissionsForRole(role)).toContain('admin.access');
    }
  });

  it('builds an administrative principal without workspaceId', async () => {
    const principal = await createService().resolvePrincipal(
      '33333333-3333-4333-8333-333333333333',
      'session-1',
    );

    expect(principal).toEqual(
      expect.objectContaining({
        userId: identity.userId,
        identityTenantId: identity.tenantId,
        sessionId: 'session-1',
        sessionContext: 'admin',
      }),
    );
    expect(principal).not.toHaveProperty('workspaceId');
  });
});
