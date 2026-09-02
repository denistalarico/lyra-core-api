// Lyra Social S1.4.9 §26 — the routes enforce product-bound authorization
// and take the client scope from the resolved context, never from the caller.

import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import type {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Readable } from 'node:stream';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, PlatformPermissionService } from '../permissions';
import { BrandKitController } from './brand-kit.controller';
import { BrandKitService } from './services/brand-kit.service';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = '00000000-0000-4000-8000-000000000003';
const CLIENT_ID = '00000000-0000-4000-8000-000000000004';
const ASSET_ID = '00000000-0000-4000-8000-000000000005';

const VIEW = 'social.brandkit.asset.view.client';
const MANAGE = 'social.brandkit.assets.manage.manager_or_admin';
const DELETE = 'social.brandkit.asset.delete.owner_or_admin_explicit';
const LEADFLOW_SETTINGS = 'leadflow.settings.general.update.admin';

function assertCanHolding(...heldPermissionKeys: string[]) {
  return jest.fn((_context: unknown, permissionKey: string) => {
    if (!heldPermissionKeys.includes(permissionKey)) {
      return Promise.reject(
        new ForbiddenException(
          `You do not have the required permission: ${permissionKey}.`,
        ),
      );
    }
    return Promise.resolve();
  });
}

const emptyKit = {
  id: null,
  scope: { agencyClientId: null },
  palette: [],
  typography: [],
  guidelines: null,
  assets: [],
  updatedAt: null,
};

describe('/brand-kit — product-bound authorization', () => {
  let app: INestApplication;
  const assertCan = jest.fn();
  const getBrandKit = jest.fn();
  const updateBrandKit = jest.fn();
  const listAssets = jest.fn();
  const uploadAsset = jest.fn();
  const getAssetContent = jest.fn();
  const deleteAsset = jest.fn();

  function authGuard(
    productKey: 'social' | 'leadflow' | 'agency',
    clientId: string | null,
  ): CanActivate {
    return {
      canActivate(context: ExecutionContext) {
        const httpRequest = context.switchToHttp().getRequest<{
          user?: unknown;
          managedContext?: unknown;
        }>();
        httpRequest.user = {
          tenantId: TENANT_ID,
          workspaceId: WORKSPACE_ID,
          sub: USER_ID,
          role: 'owner',
        };
        httpRequest.managedContext = {
          productKey,
          operatingMode: clientId ? 'client' : 'agency',
          clientId,
          managedTenantId: null,
        };
        return true;
      },
    };
  }

  async function buildApp(
    productKey: 'social' | 'leadflow' | 'agency' = 'social',
    clientId: string | null = null,
  ) {
    const module = await Test.createTestingModule({
      controllers: [BrandKitController],
      providers: [
        {
          provide: BrandKitService,
          useValue: {
            getBrandKit,
            updateBrandKit,
            listAssets,
            uploadAsset,
            getAssetContent,
            deleteAsset,
          },
        },
        { provide: PlatformPermissionService, useValue: { assertCan } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(authGuard(productKey, clientId))
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    const built = module.createNestApplication();
    // The same pipe main.ts installs globally, so these tests exercise the
    // validation the deployed app actually applies — `forbidNonWhitelisted`
    // in particular is what rejects an unexpected body key.
    built.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await built.init();
    return built;
  }

  beforeEach(() => {
    getBrandKit.mockResolvedValue(emptyKit);
    updateBrandKit.mockResolvedValue(emptyKit);
    listAssets.mockResolvedValue([]);
    uploadAsset.mockResolvedValue({ id: ASSET_ID });
    deleteAsset.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    jest.clearAllMocks();
    if (app) await app.close();
  });

  describe('read', () => {
    it('requires the Social view key', async () => {
      assertCan.mockImplementation(assertCanHolding(VIEW));
      app = await buildApp();

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .get('/brand-kit')
        .expect(200);

      expect(assertCan).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_ID }),
        VIEW,
      );
    });

    it('denies a caller holding no Brand Kit permission', async () => {
      assertCan.mockImplementation(assertCanHolding());
      app = await buildApp();

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .get('/brand-kit')
        .expect(403);

      expect(getBrandKit).not.toHaveBeenCalled();
    });
  });

  describe('write requires more than read', () => {
    it('PATCH requires the manage key — the view key alone is not enough', async () => {
      assertCan.mockImplementation(assertCanHolding(VIEW));
      app = await buildApp();

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .patch('/brand-kit')
        .send({ guidelines: 'x' })
        .expect(403);

      expect(updateBrandKit).not.toHaveBeenCalled();
    });

    it('PATCH succeeds with the manage key', async () => {
      assertCan.mockImplementation(assertCanHolding(MANAGE));
      app = await buildApp();

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .patch('/brand-kit')
        .send({ guidelines: 'Nunca distorcer.' })
        .expect(200);

      expect(assertCan).toHaveBeenCalledWith(expect.anything(), MANAGE);
    });

    it('DELETE requires the owner-only delete key, not the manage key', async () => {
      assertCan.mockImplementation(assertCanHolding(VIEW, MANAGE));
      app = await buildApp();

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .delete(`/brand-kit/assets/${ASSET_ID}`)
        .expect(403);

      expect(deleteAsset).not.toHaveBeenCalled();
      expect(assertCan).toHaveBeenCalledWith(expect.anything(), DELETE);
    });

    it('DELETE succeeds with the delete key and returns 204', async () => {
      assertCan.mockImplementation(assertCanHolding(DELETE));
      app = await buildApp();

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .delete(`/brand-kit/assets/${ASSET_ID}`)
        .expect(204);

      expect(deleteAsset).toHaveBeenCalled();
    });

    it('DELETE reports 5xx when the physical removal did not finish', async () => {
      // The row survives tombstoned so the delete is retryable; answering
      // 204 here would tell the caller the binary is gone when it is not.
      assertCan.mockImplementation(assertCanHolding(DELETE));
      deleteAsset.mockRejectedValueOnce(new Error('bucket unreachable'));
      app = await buildApp();

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .delete(`/brand-kit/assets/${ASSET_ID}`)
        .expect(500);
    });
  });

  describe('cross-product isolation', () => {
    it('a LeadFlow context is refused even holding LeadFlow settings permissions', async () => {
      assertCan.mockImplementation(
        assertCanHolding(LEADFLOW_SETTINGS, VIEW, MANAGE, DELETE),
      );
      app = await buildApp('leadflow');

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .get('/brand-kit')
        .expect(403);

      // Refused before any key is asserted: no leadflow.brandkit.* key
      // exists to bind, so the resolver itself rejects.
      expect(getBrandKit).not.toHaveBeenCalled();
    });

    it('an agency-shell context (no product asking) is refused', async () => {
      assertCan.mockImplementation(assertCanHolding(VIEW, MANAGE, DELETE));
      app = await buildApp('agency');

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .get('/brand-kit')
        .expect(403);

      expect(getBrandKit).not.toHaveBeenCalled();
    });

    it('holding only a LeadFlow permission never authorizes a Social-context call', async () => {
      assertCan.mockImplementation(assertCanHolding(LEADFLOW_SETTINGS));
      app = await buildApp('social');

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .get('/brand-kit')
        .expect(403);
    });
  });

  describe('scope comes from the resolved context', () => {
    it('agency mode passes a null client id', async () => {
      assertCan.mockImplementation(assertCanHolding(VIEW));
      app = await buildApp('social', null);

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .get('/brand-kit')
        .expect(200);

      expect(getBrandKit).toHaveBeenCalledWith(expect.anything(), null);
    });

    it('client mode passes exactly the client the guard resolved', async () => {
      assertCan.mockImplementation(assertCanHolding(VIEW));
      app = await buildApp('social', CLIENT_ID);

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .get('/brand-kit')
        .expect(200);

      expect(getBrandKit).toHaveBeenCalledWith(expect.anything(), CLIENT_ID);
    });

    it('a client id in the body is rejected outright — scope is never taken from the payload', async () => {
      assertCan.mockImplementation(assertCanHolding(MANAGE));
      app = await buildApp('social', null);

      // `forbidNonWhitelisted` refuses the unexpected key rather than
      // silently stripping it, so an attempt to steer the scope from the
      // body fails loudly instead of appearing to succeed.
      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .patch('/brand-kit')
        .send({ guidelines: 'x', agencyClientId: CLIENT_ID })
        .expect(400);

      expect(updateBrandKit).not.toHaveBeenCalled();
    });

    it('a well-formed PATCH is scoped by the context alone', async () => {
      assertCan.mockImplementation(assertCanHolding(MANAGE));
      app = await buildApp('social', CLIENT_ID);

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .patch('/brand-kit')
        .send({ guidelines: 'x' })
        .expect(200);

      expect(updateBrandKit).toHaveBeenCalledWith(
        expect.anything(),
        CLIENT_ID,
        { guidelines: 'x' },
      );
    });
  });

  describe('payload validation', () => {
    it('rejects a malformed palette colour', async () => {
      assertCan.mockImplementation(assertCanHolding(MANAGE));
      app = await buildApp();

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .patch('/brand-kit')
        .send({ palette: [{ role: 'primary', hex: 'not-a-colour' }] })
        .expect(400);

      expect(updateBrandKit).not.toHaveBeenCalled();
    });

    it('rejects an unknown asset kind on upload', async () => {
      assertCan.mockImplementation(assertCanHolding(MANAGE));
      app = await buildApp();

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .post('/brand-kit/assets')
        .field('kind', 'malware')
        .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'logo.png')
        .expect(400);

      expect(uploadAsset).not.toHaveBeenCalled();
    });
  });

  describe('content delivery headers', () => {
    it('streams bytes with a private, non-sniffable, inline response', async () => {
      assertCan.mockImplementation(assertCanHolding(VIEW));
      getAssetContent.mockResolvedValue({
        asset: { mimeType: 'image/png', originalFilename: 'logo.png' },
        file: { body: Readable.from([Buffer.from([0x89, 0x50])]) },
      });
      app = await buildApp();

      const response = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(`/brand-kit/assets/${ASSET_ID}/content`)
        .expect(200);

      expect(response.headers['content-type']).toContain('image/png');
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-disposition']).toContain('inline');
      // Bytes, not base64 JSON — S1.4.10 reads this as a Blob.
      expect(Buffer.isBuffer(response.body)).toBe(true);
    });

    it('requires the view permission to read bytes', async () => {
      assertCan.mockImplementation(assertCanHolding());
      app = await buildApp();

      await request(app.getHttpServer() as Parameters<typeof request>[0])
        .get(`/brand-kit/assets/${ASSET_ID}/content`)
        .expect(403);

      expect(getAssetContent).not.toHaveBeenCalled();
    });
  });
});
