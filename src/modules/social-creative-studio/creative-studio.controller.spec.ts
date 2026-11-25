import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import express from 'express';
import request from 'supertest';
import { Readable } from 'node:stream';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PERMISSION_KEYS } from '../permissions/catalog/permission-keys.catalog';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import type { RequestContext } from '../../common/context/request-context.interface';
import { CreativeStudioController } from './creative-studio.controller';
import {
  CreateCreativeVersionDto,
  ListCreativeAssetsQueryDto,
} from './dto/creative-studio.dto';
import {
  CREATIVE_DOCUMENT_SOURCE,
  MediaAssetDirectUploadService,
  MediaAssetEntity,
  MediaAssetUploadService,
} from '../../common/media-assets';
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

const studioContext = {
  userId: 'user-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
} as RequestContext;

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
  it('accepts document and media filters in the scoped library', async () => {
    for (const assetType of ['document', 'media']) {
      const errors = await validate(
        plainToInstance(ListCreativeAssetsQueryDto, { assetType }),
      );
      expect(errors).toEqual([]);
    }
  });

  it.each([true, false])(
    'validates stored CSV bytes during direct completion (valid: %s)',
    async (valid) => {
      const body = valid ? Buffer.from('name\nAda') : Buffer.from([0xff, 0, 1]);
      const files = {
        hasR2: () => true,
        r2Path: (path: string) => path,
        createPrivateMultipartUpload: jest.fn().mockResolvedValue('upload-id'),
        completePrivateMultipartUpload: jest.fn(),
        headPrivateObject: async () => ({ byteSize: body.length }),
        readPrivateRange: jest.fn().mockResolvedValue(body),
        deleteObject: jest.fn(),
      };
      const save = jest.fn((row: MediaAssetEntity) => row);
      const uploads = new MediaAssetUploadService(
        {
          findOne: async () => null,
          create: (row: MediaAssetEntity) => row,
          save,
        } as never,
        files as never,
        {} as never,
      );
      const directUploads = new MediaAssetDirectUploadService(
        files as never,
        uploads,
        new ConfigService({ files: { r2: { secretAccessKey: 'fixture' } } }),
      );
      const assets = { upload: jest.fn() };
      const controller = new CreativeStudioController(
        assets as never,
        {} as never,
        files as never,
        {} as never,
        {} as never,
        {} as never,
        directUploads,
      );
      const { token } = await controller.startDirectUpload(studioContext, {
        filename: 'brief.csv',
        mimeType: 'application/octet-stream',
        byteSize: body.length,
      });
      expect(files.createPrivateMultipartUpload).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: 'application/octet-stream' }),
      );
      const completion = controller.completeDirectUpload(studioContext, {
        token,
        parts: [{ partNumber: 1, etag: 'part-etag' }],
      });
      if (valid) {
        await completion;
        expect(save).toHaveBeenCalledWith(
          expect.objectContaining({
            source: CREATIVE_DOCUMENT_SOURCE,
            mimeType: 'text/csv',
          }),
        );
        expect(assets.upload).toHaveBeenCalledTimes(1);
      } else {
        await expect(completion).rejects.toMatchObject({
          status: 400,
          response: { code: 'creative_document_invalid_format' },
        });
        expect(save).not.toHaveBeenCalled();
        expect(assets.upload).not.toHaveBeenCalled();
        expect(files.deleteObject).toHaveBeenCalledTimes(1);
      }
      expect(files.readPrivateRange).toHaveBeenCalledWith(
        expect.any(String),
        0,
        body.length - 1,
      );
    },
  );

  it('serves a stored XML document only as a nosniff attachment', async () => {
    const xml = '<?xml version="1.0"?><document/>';
    const assets = {
      content: jest.fn().mockResolvedValue({
        assetType: 'document',
        mimeType: 'application/xml',
        name: 'Relatório',
        storagePath: 'private/document.xml',
      }),
    };
    const files = {
      getPrivateAsset: async () => ({ body: Readable.from([xml]) }),
    };
    const controller = new CreativeStudioController(
      assets as never,
      {} as never,
      files as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const app = express();
    app.get('/content', (_req, res, next) => {
      controller
        .content(studioContext, 'asset-id', 'version-id', res)
        .catch(next);
    });
    const result = await request(app)
      .get('/content')
      .expect(200)
      .expect('Content-Type', 'application/octet-stream')
      .expect('X-Content-Type-Options', 'nosniff')
      .expect('Content-Disposition', /^attachment;.*\.xml/);
    expect(Buffer.from(result.body as Uint8Array).toString()).toBe(xml);
  });
  it('loads Brand Context exclusively from the resolved company-aware request scope', () => {
    const brandContext = { load: jest.fn().mockResolvedValue({}) };
    const controller = new CreativeStudioController(
      {} as never,
      {} as never,
      {} as never,
      brandContext as never,
      {} as never,
      {} as never,
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
        managedContext: {
          ...clientContext.managedContext!,
          companyContextId: null,
        },
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
      {} as never,
      {} as never,
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
        getModuleAccess: jest.fn().mockResolvedValue({}),
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
      getModuleAccess: jest.fn().mockResolvedValue({}),
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
      getModuleAccess: jest.fn().mockResolvedValue({}),
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
