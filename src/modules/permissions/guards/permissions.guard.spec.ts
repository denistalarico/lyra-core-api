import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ANY_PERMISSION_KEYS_METADATA,
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../decorators/permissions.decorators';
import { PermissionsGuard } from './permissions.guard';

function createExecutionContext(
  request: Record<string, unknown> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        params: {},
        ...request,
      }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as ExecutionContext;
}

function createGuard(metadata: Map<string, unknown>) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata.get(key)),
  } as unknown as Pick<Reflector, 'getAllAndOverride'> as Reflector;

  const permissionService = {
    assertCan: jest.fn(),
    assertAny: jest.fn(),
    canAccessProduct: jest.fn(),
    canAccessClient: jest.fn(),
    canAccessClientProduct: jest.fn(),
    auditPermissionDecision: jest.fn(),
    isDangerousAction: jest.fn(),
  };
  const operationalContextResolver = {
    resolve: jest.fn().mockResolvedValue({
      productKey: 'agency',
      operatingMode: 'agency',
      clientId: null,
      managedTenantId: null,
    }),
  };

  return {
    guard: new PermissionsGuard(
      reflector,
      permissionService as never,
      operationalContextResolver as never,
    ),
    permissionService,
    operationalContextResolver,
  };
}

describe('PermissionsGuard', () => {
  it('allows routes without permission metadata even when request has no user', async () => {
    const { guard, permissionService } = createGuard(new Map());

    await expect(guard.canActivate(createExecutionContext())).resolves.toBe(
      true,
    );
    expect(permissionService.assertCan).not.toHaveBeenCalled();
  });

  it('requires authenticated context when a permission decorator is present', async () => {
    const metadata = new Map<string, unknown>([
      [PERMISSION_KEY_METADATA, 'agency.settings.users.manage.admin'],
    ]);
    const { guard } = createGuard(metadata);

    await expect(
      guard.canActivate(createExecutionContext()),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('passes authenticated tenant context to permission checks', async () => {
    const metadata = new Map<string, unknown>([
      [PERMISSION_KEY_METADATA, 'agency.settings.users.manage.admin'],
    ]);
    const { guard, permissionService } = createGuard(metadata);

    await expect(
      guard.canActivate(
        createExecutionContext({
          method: 'GET',
          route: { path: '/agency/settings/users' },
          user: {
            sub: 'user-1',
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            role: 'admin',
          },
        }),
      ),
    ).resolves.toBe(true);

    expect(permissionService.assertCan).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: 'admin',
      },
      'agency.settings.users.manage.admin',
      {
        method: 'GET',
        routePath: '/agency/settings/users',
        params: {},
        query: undefined,
        body: undefined,
      },
    );
  });

  it('passes alternative permissions to assertAny', async () => {
    const metadata = new Map<string, unknown>([
      [
        ANY_PERMISSION_KEYS_METADATA,
        [
          'agency.calendar.events.view.self',
          'agency.calendar.events.view.department',
        ],
      ],
    ]);
    const { guard, permissionService } = createGuard(metadata);

    await expect(
      guard.canActivate(
        createExecutionContext({
          method: 'GET',
          route: { path: '/calendar/events' },
          user: {
            sub: 'user-1',
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            role: 'member',
          },
        }),
      ),
    ).resolves.toBe(true);

    expect(permissionService.assertAny).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
        role: 'member',
      },
      [
        'agency.calendar.events.view.self',
        'agency.calendar.events.view.department',
      ],
      {
        method: 'GET',
        routePath: '/calendar/events',
        params: {},
        query: undefined,
        body: undefined,
      },
    );
  });

  it('denies a client-mode LeadFlow request when the caller is not authorized for that client', async () => {
    const metadata = new Map<string, unknown>([
      [PRODUCT_ENTITLEMENT_METADATA, 'leadflow'],
    ]);
    const { guard, permissionService, operationalContextResolver } =
      createGuard(metadata);
    operationalContextResolver.resolve.mockResolvedValue({
      productKey: 'leadflow',
      operatingMode: 'client',
      clientId: 'client-1',
      managedTenantId: 'managed-tenant-1',
    });
    permissionService.canAccessProduct.mockResolvedValue(true);
    permissionService.canAccessClientProduct.mockResolvedValue(false);

    await expect(
      guard.canActivate(
        createExecutionContext({
          method: 'GET',
          route: { path: '/leadflow/crm/pipelines' },
          headers: { 'x-lyra-client-id': 'client-1' },
          user: {
            sub: 'user-1',
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            role: 'member',
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(permissionService.canAccessClientProduct).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'member',
      clientId: 'client-1',
      productKey: 'leadflow',
    });
  });

  it('allows a client-mode LeadFlow request once managed client-product access is confirmed', async () => {
    const metadata = new Map<string, unknown>([
      [PRODUCT_ENTITLEMENT_METADATA, 'leadflow'],
    ]);
    const { guard, permissionService, operationalContextResolver } =
      createGuard(metadata);
    operationalContextResolver.resolve.mockResolvedValue({
      productKey: 'leadflow',
      operatingMode: 'client',
      clientId: 'client-1',
      managedTenantId: 'managed-tenant-1',
    });
    permissionService.canAccessProduct.mockResolvedValue(true);
    permissionService.canAccessClientProduct.mockResolvedValue(true);

    await expect(
      guard.canActivate(
        createExecutionContext({
          method: 'GET',
          route: { path: '/leadflow/crm/pipelines' },
          headers: { 'x-lyra-client-id': 'client-1' },
          user: {
            sub: 'user-1',
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            role: 'member',
          },
        }),
      ),
    ).resolves.toBe(true);
  });

  it('does not enforce managed client-product access in agency operating mode', async () => {
    const metadata = new Map<string, unknown>([
      [PRODUCT_ENTITLEMENT_METADATA, 'leadflow'],
    ]);
    const { guard, permissionService, operationalContextResolver } =
      createGuard(metadata);
    operationalContextResolver.resolve.mockResolvedValue({
      productKey: 'leadflow',
      operatingMode: 'agency',
      clientId: null,
      managedTenantId: null,
    });
    permissionService.canAccessProduct.mockResolvedValue(true);

    await expect(
      guard.canActivate(
        createExecutionContext({
          method: 'GET',
          route: { path: '/leadflow/crm/pipelines' },
          user: {
            sub: 'user-1',
            tenantId: 'tenant-1',
            workspaceId: 'workspace-1',
            role: 'member',
          },
        }),
      ),
    ).resolves.toBe(true);

    expect(permissionService.canAccessClientProduct).not.toHaveBeenCalled();
  });
});
