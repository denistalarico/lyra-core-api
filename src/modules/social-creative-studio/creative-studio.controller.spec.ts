import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PERMISSION_KEYS } from '../permissions/catalog/permission-keys.catalog';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import type { RequestContext } from '../../common/context/request-context.interface';
import { CreativeStudioController } from './creative-studio.controller';
import { CreateCreativeVersionDto } from './dto/creative-studio.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

const ROUTE_PERMISSIONS = {
  brandContextForStudio: 'social.creative.content.view.assigned',
  list: 'social.creative.content.view.assigned',
  detail: 'social.creative.content.view.assigned',
  content: 'social.creative.content.view.assigned',
  thumbnail: 'social.creative.content.view.assigned',
  versions: 'social.creative.content.view.assigned',
  foldersList: 'social.creative.content.view.assigned',
  upload: 'social.creative.content.create_draft.assigned',
  createFolder: 'social.creative.content.create_draft.assigned',
  update: 'social.creative.content.update.assigned',
  updateFolder: 'social.creative.content.update.assigned',
  version: 'social.creative.content.update.assigned',
  archive: 'social.creative.content.delete.owner_or_admin_explicit',
  deleteFolder: 'social.creative.content.delete.owner_or_admin_explicit',
} as const;

function executionContext(handler: unknown): ExecutionContext {
  const request = {
    method: 'POST',
    route: { path: '/social/creative-studio/assets' },
    params: {},
    user: {
      sub: 'user-a',
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      role: 'member',
    },
    managedContext: {
      operatingMode: 'agency',
      productKey: 'social',
      clientId: null,
      managedTenantId: null,
    },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => CreativeStudioController,
  } as unknown as ExecutionContext;
}

describe('Creative Studio controller permission contract', () => {
  it('loads Brand Context exclusively from the resolved company-aware request scope', () => {
    const brandContext = { load: jest.fn().mockResolvedValue({}) };
    const controller = new CreativeStudioController(
      {} as never,
      {} as never,
      {} as never,
      brandContext as never,
      {} as never,
    );
    const clientContext = {
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      managedContext: {
        productKey: 'social',
        operatingMode: 'client',
        clientId: 'client-a',
        companyContextId: 'company-a',
        managedTenantId: 'managed-tenant-a',
      },
    } as RequestContext;

    controller.brandContextForStudio(clientContext);

    expect(brandContext.load).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      companyContextId: 'company-a',
    });
    expect(() =>
      controller.brandContextForStudio({
        ...clientContext,
        managedContext: { ...clientContext.managedContext!, companyContextId: null },
      }),
    ).toThrow(BadRequestException);
    expect(brandContext.load).toHaveBeenCalledTimes(1);
  });

  it('CS2B.6: routes a version with revisesVersionId to the revision loop and a plain one to generic versioning', async () => {
    const assets = { createVersion: jest.fn().mockResolvedValue({ id: 'v' }) };
    const versionApprovals = {
      startRevision: jest.fn().mockResolvedValue({ id: 'v' }),
    };
    const controller = new CreativeStudioController(
      assets as never,
      {} as never,
      {} as never,
      {} as never,
      versionApprovals as never,
    );
    const ctx = {
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      userId: 'user-a',
      managedContext: {
        productKey: 'social',
        operatingMode: 'client',
        clientId: 'client-a',
        companyContextId: 'company-a',
        managedTenantId: 'managed-tenant-a',
      },
    } as RequestContext;
    const scope = {
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      companyContextId: 'company-a',
    };
    const file = { buffer: Buffer.from('x') } as Express.Multer.File;
    const assetId = '11111111-1111-4111-8111-111111111111';
    const versionId = 'aaaaaaaa-0001-4000-8000-000000000001';

    await controller.version(ctx, assetId, file, {
      revisesVersionId: versionId,
    });
    expect(versionApprovals.startRevision).toHaveBeenCalledWith(
      scope,
      'user-a',
      assetId,
      versionId,
      file,
    );
    expect(assets.createVersion).not.toHaveBeenCalled();

    await controller.version(ctx, assetId, file, {});
    expect(assets.createVersion).toHaveBeenCalledWith(
      scope,
      'user-a',
      assetId,
      file,
    );
    expect(versionApprovals.startRevision).toHaveBeenCalledTimes(1);
  });

  it('CS2B.6: only accepts a UUID as revisesVersionId', async () => {
    const dto = plainToInstance(CreateCreativeVersionDto, {
      revisesVersionId: 'v1',
    });
    expect(await validate(dto)).toHaveLength(1);
    expect(
      await validate(
        plainToInstance(CreateCreativeVersionDto, {
          revisesVersionId: 'aaaaaaaa-0001-4000-8000-000000000001',
        }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(plainToInstance(CreateCreativeVersionDto, {})),
    ).toHaveLength(0);
  });

  it('applies JWT, permission and Social entitlement guards at the controller boundary', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CreativeStudioController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        CreativeStudioController,
      ),
    ).toBe('social');
  });

  it.each(Object.entries(ROUTE_PERMISSIONS))(
    '%s uses the existing permission catalog key',
    (handlerName, permission) => {
      const handler = (
        CreativeStudioController.prototype as unknown as Record<
          string,
          () => unknown
        >
      )[handlerName];
      expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, handler)).toBe(
        permission,
      );
      expect(PERMISSION_KEYS).toContain(permission);
    },
  );

  it.each(Object.entries(ROUTE_PERMISSIONS))(
    '%s is admitted when the Social entitlement and its permission are granted',
    async (handlerName, permission) => {
      const permissionService = {
        canAccessProduct: jest.fn().mockResolvedValue(true),
        assertCan: jest.fn().mockResolvedValue(undefined),
        assertAny: jest.fn(),
        canAccessClient: jest.fn(),
        canAccessClientProduct: jest.fn(),
        auditPermissionDecision: jest.fn(),
        isDangerousAction: jest.fn(),
      };
      const guard = new PermissionsGuard(
        new Reflector(),
        permissionService as never,
        { resolve: jest.fn() } as never,
      );
      const handler = (
        CreativeStudioController.prototype as unknown as Record<
          string,
          () => unknown
        >
      )[handlerName];

      await expect(guard.canActivate(executionContext(handler))).resolves.toBe(
        true,
      );
      expect(permissionService.assertCan).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-a' }),
        permission,
        expect.objectContaining({ method: 'POST' }),
      );
    },
  );

  it('returns the guard denial when the authenticated user lacks the route permission', async () => {
    const permissionService = {
      canAccessProduct: jest.fn().mockResolvedValue(true),
      assertCan: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('Missing permission.')),
      assertAny: jest.fn(),
      canAccessClient: jest.fn(),
      canAccessClientProduct: jest.fn(),
      auditPermissionDecision: jest.fn(),
      isDangerousAction: jest.fn(),
    };
    const resolver = { resolve: jest.fn() };
    const guard = new PermissionsGuard(
      new Reflector(),
      permissionService as never,
      resolver as never,
    );
    const handler = CreativeStudioController.prototype.upload;

    await expect(
      guard.canActivate(executionContext(handler)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(permissionService.canAccessProduct).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      'social',
    );
    expect(permissionService.assertCan).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      ROUTE_PERMISSIONS.upload,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns the guard denial when the Social product entitlement is unavailable', async () => {
    const permissionService = {
      canAccessProduct: jest.fn().mockResolvedValue(false),
      assertCan: jest.fn(),
      assertAny: jest.fn(),
      canAccessClient: jest.fn(),
      canAccessClientProduct: jest.fn(),
      auditPermissionDecision: jest.fn(),
      isDangerousAction: jest.fn(),
    };
    const guard = new PermissionsGuard(
      new Reflector(),
      permissionService as never,
      { resolve: jest.fn() } as never,
    );

    await expect(
      guard.canActivate(
        executionContext(CreativeStudioController.prototype.list),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(permissionService.assertCan).not.toHaveBeenCalled();
  });
});
