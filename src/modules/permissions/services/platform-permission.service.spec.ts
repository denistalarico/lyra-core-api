import {
  ClientProductRoleKey,
  PlatformRoleKey,
} from '../enums/permission.enums';
import { ProductEntitlementStatus } from '../../platform';
import { PlatformPermissionService } from './platform-permission.service';

function createRepositoryMock() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((value) => value),
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function createService() {
  const rolesRepository = createRepositoryMock();
  const rolePermissionsRepository = createRepositoryMock();
  const userPermissionsRepository = createRepositoryMock();
  const clientAccessRepository = createRepositoryMock();
  const clientProductAccessRepository = createRepositoryMock();
  const clientsRepository = createRepositoryMock();
  const entitlementsRepository = createRepositoryMock();
  const auditRepository = createRepositoryMock();
  const platformContextService = {
    getContext: jest.fn().mockResolvedValue({ products: [] }),
  };
  const scopeEvaluator = {
    assertScope: jest.fn().mockResolvedValue(undefined),
  };

  const service = new PlatformPermissionService(
    rolesRepository as never,
    rolePermissionsRepository as never,
    userPermissionsRepository as never,
    clientAccessRepository as never,
    clientProductAccessRepository as never,
    clientsRepository as never,
    entitlementsRepository as never,
    auditRepository as never,
    platformContextService as never,
    scopeEvaluator as never,
  );

  return {
    service,
    rolesRepository,
    rolePermissionsRepository,
    userPermissionsRepository,
    clientAccessRepository,
    clientProductAccessRepository,
    clientsRepository,
    entitlementsRepository,
    scopeEvaluator,
  };
}

const activeClient = {
  id: 'client-1',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  managedTenantId: 'managed-tenant-1',
  status: 'active',
  archivedAt: null,
};

const activeEntitlement = {
  tenantId: 'managed-tenant-1',
  productKey: 'social',
  status: ProductEntitlementStatus.Active,
  startsAt: null,
  endsAt: null,
  trialEndsAt: null,
};

describe('PlatformPermissionService', () => {
  it('scopes client access checks to the active workspace when present', async () => {
    const { service, clientAccessRepository } = createService();
    clientAccessRepository.findOne.mockResolvedValue({
      accessLevel: 'relationship',
    });

    await expect(
      service.canAccessClient({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: PlatformRoleKey.Member,
        clientId: 'client-1',
      }),
    ).resolves.toBe(true);

    expect(clientAccessRepository.findOne).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        clientId: 'client-1',
        userId: 'user-1',
      },
    });
  });

  it('denies client product access when the client has no active product entitlement', async () => {
    const { service, clientsRepository, entitlementsRepository } =
      createService();
    clientsRepository.findOne.mockResolvedValue(activeClient);
    entitlementsRepository.findOne.mockResolvedValue({
      ...activeEntitlement,
      status: ProductEntitlementStatus.Suspended,
    });

    await expect(
      service.canAccessClientProduct({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: PlatformRoleKey.Manager,
        clientId: 'client-1',
        productKey: 'social',
      }),
    ).resolves.toBe(false);
  });

  it('denies client product access when the product is active but the user has no product access', async () => {
    const {
      service,
      clientsRepository,
      entitlementsRepository,
      clientAccessRepository,
      clientProductAccessRepository,
    } = createService();
    clientsRepository.findOne.mockResolvedValue(activeClient);
    entitlementsRepository.findOne.mockResolvedValue(activeEntitlement);
    clientAccessRepository.findOne.mockResolvedValue({
      managedTenantId: 'managed-tenant-1',
      accessLevel: 'relationship',
    });
    clientProductAccessRepository.findOne.mockResolvedValue(null);

    await expect(
      service.canAccessClientProduct({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: PlatformRoleKey.Manager,
        clientId: 'client-1',
        productKey: 'social',
      }),
    ).resolves.toBe(false);
  });

  it('denies client product access when the user role is below the required product role', async () => {
    const {
      service,
      clientsRepository,
      entitlementsRepository,
      clientAccessRepository,
      clientProductAccessRepository,
    } = createService();
    clientsRepository.findOne.mockResolvedValue(activeClient);
    entitlementsRepository.findOne.mockResolvedValue(activeEntitlement);
    clientAccessRepository.findOne.mockResolvedValue({
      managedTenantId: 'managed-tenant-1',
      accessLevel: 'relationship',
    });
    clientProductAccessRepository.findOne.mockResolvedValue({
      roleKey: ClientProductRoleKey.Member,
    });

    await expect(
      service.canAccessClientProduct({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: PlatformRoleKey.Member,
        clientId: 'client-1',
        productKey: 'social',
        requiredRole: ClientProductRoleKey.Manager,
      }),
    ).resolves.toBe(false);
  });

  it('denies client product access when the client has no managed tenant link', async () => {
    const { service, clientsRepository } = createService();
    clientsRepository.findOne.mockResolvedValue({
      ...activeClient,
      managedTenantId: null,
    });

    await expect(
      service.canAccessClientProduct({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: PlatformRoleKey.Manager,
        clientId: 'client-1',
        productKey: 'social',
      }),
    ).resolves.toBe(false);
  });

  it('denies client product access when the client access managed tenant does not match', async () => {
    const {
      service,
      clientsRepository,
      entitlementsRepository,
      clientAccessRepository,
    } = createService();
    clientsRepository.findOne.mockResolvedValue(activeClient);
    entitlementsRepository.findOne.mockResolvedValue(activeEntitlement);
    clientAccessRepository.findOne.mockResolvedValue({
      managedTenantId: 'other-managed-tenant',
      accessLevel: 'relationship',
    });

    await expect(
      service.canAccessClientProduct({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: PlatformRoleKey.Manager,
        clientId: 'client-1',
        productKey: 'social',
      }),
    ).resolves.toBe(false);
  });

  it('allows valid client product access when client, entitlement and role chain match', async () => {
    const {
      service,
      clientsRepository,
      entitlementsRepository,
      clientAccessRepository,
      clientProductAccessRepository,
    } = createService();
    clientsRepository.findOne.mockResolvedValue(activeClient);
    entitlementsRepository.findOne.mockResolvedValue({
      ...activeEntitlement,
      productKey: 'leadflow',
    });
    clientAccessRepository.findOne.mockResolvedValue({
      managedTenantId: 'managed-tenant-1',
      accessLevel: 'relationship',
    });
    clientProductAccessRepository.findOne.mockResolvedValue({
      roleKey: ClientProductRoleKey.Admin,
    });

    await expect(
      service.canAccessClientProduct({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: PlatformRoleKey.Member,
        clientId: 'client-1',
        productKey: 'leadflow',
        requiredRole: ClientProductRoleKey.Manager,
      }),
    ).resolves.toBe(true);

    expect(clientProductAccessRepository.findOne).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        clientId: 'client-1',
        managedTenantId: 'managed-tenant-1',
        productKey: 'leadflow',
        userId: 'user-1',
      },
    });
  });

  it('denies Owner client product access for nonexistent or other-tenant clients', async () => {
    const { service, clientsRepository } = createService();
    clientsRepository.findOne.mockResolvedValue(null);

    await expect(
      service.canAccessClientProduct({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'owner-1',
        role: PlatformRoleKey.Owner,
        clientId: 'missing-client',
        productKey: 'social',
      }),
    ).resolves.toBe(false);

    expect(clientsRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: 'missing-client',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
      },
    });
  });

  it('validates resource scope after a permission key is granted', async () => {
    const { service, scopeEvaluator } = createService();

    await expect(
      service.assertCan(
        {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          userId: 'owner-1',
          role: PlatformRoleKey.Owner,
        },
        'agency.clients.profile.view.basic.assigned',
        {
          routePath: '/agency/clients/:clientId',
          params: { clientId: 'client-1' },
        },
      ),
    ).resolves.toBeUndefined();

    expect(scopeEvaluator.assertScope).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'owner-1',
        role: PlatformRoleKey.Owner,
      },
      'agency.clients.profile.view.basic.assigned',
      {
        routePath: '/agency/clients/:clientId',
        params: { clientId: 'client-1' },
      },
    );
  });

  it('allows any permission alternative that passes role and scope', async () => {
    const {
      service,
      rolesRepository,
      rolePermissionsRepository,
      userPermissionsRepository,
      scopeEvaluator,
    } = createService();
    rolesRepository.findOne.mockResolvedValue({ id: 'role-1' });
    rolePermissionsRepository.find.mockResolvedValue([
      {
        permissionKey: 'agency.calendar.events.view.department',
        enabled: true,
      },
    ]);
    userPermissionsRepository.find.mockResolvedValue([]);

    await expect(
      service.assertAny(
        {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          userId: 'manager-1',
          role: PlatformRoleKey.Manager,
        },
        [
          'agency.calendar.events.view.self',
          'agency.calendar.events.view.department',
        ],
        {
          routePath: '/calendar/events/:eventId',
          params: { eventId: 'event-1' },
        },
      ),
    ).resolves.toBeUndefined();

    expect(scopeEvaluator.assertScope).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'manager-1',
        role: PlatformRoleKey.Manager,
      },
      'agency.calendar.events.view.department',
      {
        routePath: '/calendar/events/:eventId',
        params: { eventId: 'event-1' },
      },
    );
  });

  it('applies only tenant-global and active-workspace user overrides', async () => {
    const {
      service,
      rolesRepository,
      rolePermissionsRepository,
      userPermissionsRepository,
    } = createService();
    rolesRepository.findOne.mockResolvedValue({ id: 'role-1' });
    rolePermissionsRepository.find.mockResolvedValue([]);

    await service.getEffectivePermissions({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: PlatformRoleKey.Member,
    });

    expect(userPermissionsRepository.find).toHaveBeenCalledWith({
      where: [
        expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'user-1',
        }),
        {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          userId: 'user-1',
        },
      ],
    });
  });
});
