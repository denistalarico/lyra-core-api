import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { ManagedContext } from '../../../common/context/request-context.interface';
import { PermissionsGuard } from './permissions.guard';

function createGuard(options: {
  routeProduct: 'leadflow' | 'social';
  agencyEntitled: boolean;
  clientProductAllowed: boolean;
}) {
  const permissionService = {
    canAccessProduct: jest.fn().mockResolvedValue(options.agencyEntitled),
    canAccessClientProduct: jest
      .fn()
      .mockResolvedValue(options.clientProductAllowed),
    auditPermissionDecision: jest.fn().mockResolvedValue(undefined),
  };

  const guard = new PermissionsGuard(
    {
      getAllAndOverride: (key: string) =>
        key === 'permissions:product_entitlement'
          ? options.routeProduct
          : undefined,
    } as never,
    permissionService as never,
    { resolve: jest.fn() } as never,
  );

  return { guard, permissionService };
}

function executionContext(managedContext: ManagedContext): ExecutionContext {
  const request = {
    user: {
      sub: 'user-1',
      tenantId: 'agency-tenant',
      workspaceId: 'workspace-1',
      role: 'owner',
    },
    managedContext,
    method: 'GET',
    route: { path: '/social/analytics/connections' },
    params: {},
    query: {},
    body: null,
  };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

const agencySocialContext: ManagedContext = {
  productKey: 'social',
  operatingMode: 'agency',
  clientId: null,
  managedTenantId: null,
};

const clientSocialContext: ManagedContext = {
  productKey: 'social',
  operatingMode: 'client',
  clientId: 'client-1',
  managedTenantId: 'managed-tenant-1',
  clientName: 'Cliente 1',
};

describe('PermissionsGuard product context separation', () => {
  it('requires the agency entitlement in agency mode', async () => {
    const { guard, permissionService } = createGuard({
      routeProduct: 'social',
      agencyEntitled: false,
      clientProductAllowed: true,
    });

    await expect(
      guard.canActivate(executionContext(agencySocialContext)),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(permissionService.canAccessProduct).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'agency-tenant' }),
      'social',
    );
    expect(permissionService.canAccessClientProduct).not.toHaveBeenCalled();
  });

  it('accepts a client entitlement without requiring the agency entitlement', async () => {
    const { guard, permissionService } = createGuard({
      routeProduct: 'social',
      agencyEntitled: false,
      clientProductAllowed: true,
    });

    await expect(
      guard.canActivate(executionContext(clientSocialContext)),
    ).resolves.toBe(true);

    expect(permissionService.canAccessClientProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'agency-tenant',
        clientId: 'client-1',
        productKey: 'social',
      }),
    );
    expect(permissionService.canAccessProduct).not.toHaveBeenCalled();
  });

  it('refuses a client context authorized for a different product', async () => {
    const { guard, permissionService } = createGuard({
      routeProduct: 'social',
      agencyEntitled: true,
      clientProductAllowed: true,
    });

    await expect(
      guard.canActivate(
        executionContext({
          ...clientSocialContext,
          productKey: 'leadflow',
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(permissionService.canAccessClientProduct).not.toHaveBeenCalled();
    expect(permissionService.canAccessProduct).not.toHaveBeenCalled();
  });

  it('refuses a client whose Social entitlement or grant is not active', async () => {
    const { guard, permissionService } = createGuard({
      routeProduct: 'social',
      agencyEntitled: true,
      clientProductAllowed: false,
    });

    await expect(
      guard.canActivate(executionContext(clientSocialContext)),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(permissionService.auditPermissionDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        permissionKey: 'managed_context:social',
        resourceId: 'client-1',
      }),
    );
  });
});
