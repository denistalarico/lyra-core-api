import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../context/request-context.interface';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../../modules/permissions/decorators/permissions.decorators';
import { MediaAssetController } from './media-asset.controller';
import type { MediaAssetUploadService } from './media-asset-upload.service';

describe('MediaAssetController', () => {
  let controller: MediaAssetController;

  const uploadService = {
    list: jest.fn(),
    upload: jest.fn(),
    getContent: jest.fn(),
  };

  const agencyCtx: RequestContext = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    workspaceId: '22222222-2222-4222-8222-222222222222',
    userId: '55555555-5555-4555-8555-555555555555',
    managedContext: {
      productKey: 'social',
      operatingMode: 'agency',
      clientId: null,
      managedTenantId: null,
    },
  };

  const clientCtx: RequestContext = {
    ...agencyCtx,
    managedContext: {
      productKey: 'social',
      operatingMode: 'client',
      clientId: '33333333-3333-4333-8333-333333333333',
      managedTenantId: '88888888-8888-4888-8888-888888888888',
    },
  };

  const file = {
    buffer: Buffer.from('bytes'),
    originalname: 'foto.png',
    mimetype: 'image/png',
    size: 5,
  } as Express.Multer.File;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new MediaAssetController(
      uploadService as unknown as MediaAssetUploadService,
    );
  });

  it('binds the controller to the Social entitlement', () => {
    expect(
      Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, MediaAssetController),
    ).toBe('social');
  });

  it('requires the publishing view permission for listing', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        MediaAssetController.prototype.list,
      ),
    ).toBe('social.publishing.media.view.assigned');
  });

  it('requires the manager upload permission for writing', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        MediaAssetController.prototype.upload,
      ),
    ).toBe('social.publishing.media.upload.manager');
  });

  it('requires the view permission to stream bytes', () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        MediaAssetController.prototype.getContent,
      ),
    ).toBe('social.publishing.media.view.assigned');
  });

  it('lists using only server-resolved scope', async () => {
    uploadService.list.mockResolvedValue({ items: [], total: 0 });

    await controller.list(agencyCtx, {});

    expect(uploadService.list).toHaveBeenCalledWith(
      {
        tenantId: agencyCtx.tenantId,
        workspaceId: agencyCtx.workspaceId,
        agencyClientId: null,
      },
      { limit: undefined },
    );
  });

  it('maps managed client mode to the server-resolved client id', async () => {
    uploadService.list.mockResolvedValue({ items: [], total: 0 });

    await controller.list(clientCtx, {});

    expect(uploadService.list).toHaveBeenCalledWith(
      expect.objectContaining({
        agencyClientId: '33333333-3333-4333-8333-333333333333',
      }),
      { limit: undefined },
    );
  });

  it('ignores a scope a caller tries to smuggle through the upload body', async () => {
    uploadService.upload.mockResolvedValue(sampleAsset());

    await controller.upload(agencyCtx, file, {
      source: 'planner_upload',
      agencyClientId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      tenantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    } as never);

    expect(uploadService.upload).toHaveBeenCalledWith(
      {
        tenantId: agencyCtx.tenantId,
        workspaceId: agencyCtx.workspaceId,
        agencyClientId: null,
      },
      agencyCtx.userId,
      { file, source: 'planner_upload' },
    );
  });

  it('defaults the provenance when none is declared', async () => {
    uploadService.upload.mockResolvedValue(sampleAsset());

    await controller.upload(agencyCtx, file, {});

    expect(uploadService.upload).toHaveBeenCalledWith(
      expect.anything(),
      agencyCtx.userId,
      { file, source: 'planner_upload' },
    );
  });

  it('returns a view, never the entity', async () => {
    uploadService.upload.mockResolvedValue(sampleAsset());

    const result = await controller.upload(agencyCtx, file, {});
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('media-assets/tenant');
    expect(serialized).not.toContain('storagePath');
    expect(serialized).not.toContain(agencyCtx.tenantId);
    expect(serialized).not.toContain('must-not-leak');
    expect(result).toEqual(
      expect.objectContaining({ id: 'asset-1', mimeType: 'image/png' }),
    );
  });

  it('rejects requests without workspace context', async () => {
    const ctx: RequestContext = {
      tenantId: '11111111-1111-4111-8111-111111111111',
      userId: '55555555-5555-4555-8555-555555555555',
    };

    await expect(controller.list(ctx, {})).rejects.toThrow(BadRequestException);
    expect(uploadService.list).not.toHaveBeenCalled();
  });

  it('rejects client mode without a resolved client id', async () => {
    const ctx: RequestContext = {
      ...agencyCtx,
      managedContext: {
        productKey: 'social',
        operatingMode: 'client',
        clientId: null,
        managedTenantId: null,
      },
    };

    await expect(controller.list(ctx, {})).rejects.toThrow(BadRequestException);
    expect(uploadService.list).not.toHaveBeenCalled();
  });

  it('streams bytes with headers that keep private media out of shared caches', async () => {
    const headers: Record<string, string> = {};
    const pipe = jest.fn();

    uploadService.getContent.mockResolvedValue({
      asset: { mimeType: 'image/png', originalFilename: 'foto.png' },
      file: { body: { pipe } },
    });

    const response = {
      setHeader: (key: string, value: string) => {
        headers[key] = value;
      },
    };

    await controller.getContent(
      agencyCtx,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      response as never,
    );

    expect(headers['Cache-Control']).toBe('private, no-store');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Content-Type']).toBe('image/png');
    expect(pipe).toHaveBeenCalledWith(response);
  });

  function sampleAsset() {
    return {
      id: 'asset-1',
      tenantId: agencyCtx.tenantId,
      workspaceId: agencyCtx.workspaceId,
      agencyClientId: null,
      storagePath: 'media-assets/tenant/agency/asset-1.png',
      mimeType: 'image/png',
      byteSize: '5',
      originalFilename: 'foto.png',
      checksum: null,
      width: 1080,
      height: 1920,
      durationMs: null,
      codec: null,
      source: 'planner_upload',
      metadata: { opaque: 'must-not-leak' },
      createdById: agencyCtx.userId ?? null,
      createdAt: new Date('2026-09-09T12:00:00.000Z'),
      updatedAt: new Date('2026-09-09T12:00:00.000Z'),
      deletedAt: null,
    };
  }
});
