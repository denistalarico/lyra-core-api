import { ForbiddenException } from '@nestjs/common';
import type {
  CanActivate,
  ExecutionContext,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';
import { PlatformPermissionsController } from './platform-permissions.controller';
import { PlatformPermissionService } from '../services/platform-permission.service';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACE_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = '00000000-0000-4000-8000-000000000003';
const CLIENT_ID = '00000000-0000-4000-8000-000000000004';
const OTHER_TENANT_CLIENT_ID = '00000000-0000-4000-8000-000000000099';

const SOCIAL_ADMIN = 'social.settings.permissions.manage.admin';
const LEADFLOW_ADMIN = 'leadflow.settings.permissions.manage.admin';

/**
 * S1.4.7 pointed correction: `assertCan` must only be satisfied by the
 * permission key that matches the requested `productKey` — never by the
 * other product's admin key. This fake mirrors the real
 * `PlatformPermissionService.assertCan` contract (throws `ForbiddenException`
 * when the caller lacks `permissionKey`) but is driven by a fixed set of
 * keys the fake caller "holds", so each test states the matrix cell
 * directly instead of re-deriving it from mock call arguments.
 */
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

describe('GET /permissions/clients/:clientId/products/:productKey/access', () => {
  let app: INestApplication;
  const assertCan = jest.fn();
  const canAccessClientProduct = jest.fn();
  const listClientProductAccess = jest.fn();

  function authGuardAs(role: string): CanActivate {
    return {
      canActivate(context: ExecutionContext) {
        const httpRequest = context
          .switchToHttp()
          .getRequest<AuthenticatedRequest>();
        httpRequest.user = {
          tenantId: TENANT_ID,
          workspaceId: WORKSPACE_ID,
          sub: USER_ID,
          role,
        } as AuthenticatedRequest['user'];
        return true;
      },
    };
  }

  async function buildApp(role = 'admin') {
    const module = await Test.createTestingModule({
      controllers: [PlatformPermissionsController],
      providers: [
        {
          provide: PlatformPermissionService,
          useValue: {
            assertCan,
            canAccessClientProduct,
            listClientProductAccess,
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(authGuardAs(role))
      .compile();

    const built = module.createNestApplication();
    await built.init();
    return built;
  }

  afterEach(async () => {
    jest.clearAllMocks();
    if (app) {
      await app.close();
    }
  });

  it('1: social + social manage + access to the Social client → 200', async () => {
    assertCan.mockImplementation(assertCanHolding(SOCIAL_ADMIN));
    canAccessClientProduct.mockResolvedValue(true);
    listClientProductAccess.mockResolvedValue([
      { userId: 'user-a', roleKey: 'admin' },
    ]);
    app = await buildApp();

    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get(`/permissions/clients/${CLIENT_ID}/products/social/access`)
      .expect(200);

    expect(response.body).toEqual({
      clientId: CLIENT_ID,
      productKey: 'social',
      access: [{ userId: 'user-a', roleKey: 'admin' }],
    });
    expect(assertCan).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
      SOCIAL_ADMIN,
    );
  });

  it('2: social + only leadflow manage + access to the Social client → 403', async () => {
    assertCan.mockImplementation(assertCanHolding(LEADFLOW_ADMIN));
    canAccessClientProduct.mockResolvedValue(true);
    app = await buildApp();

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get(`/permissions/clients/${CLIENT_ID}/products/social/access`)
      .expect(403);

    expect(assertCan).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
      SOCIAL_ADMIN,
    );
    expect(canAccessClientProduct).not.toHaveBeenCalled();
    expect(listClientProductAccess).not.toHaveBeenCalled();
  });

  it('3: leadflow + leadflow manage + access to the LeadFlow client → 200', async () => {
    assertCan.mockImplementation(assertCanHolding(LEADFLOW_ADMIN));
    canAccessClientProduct.mockResolvedValue(true);
    listClientProductAccess.mockResolvedValue([
      { userId: 'user-b', roleKey: 'viewer' },
    ]);
    app = await buildApp();

    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get(`/permissions/clients/${CLIENT_ID}/products/leadflow/access`)
      .expect(200);

    expect(response.body).toEqual({
      clientId: CLIENT_ID,
      productKey: 'leadflow',
      access: [{ userId: 'user-b', roleKey: 'viewer' }],
    });
    expect(assertCan).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
      LEADFLOW_ADMIN,
    );
  });

  it('4: leadflow + only social manage + access to the LeadFlow client → 403', async () => {
    assertCan.mockImplementation(assertCanHolding(SOCIAL_ADMIN));
    canAccessClientProduct.mockResolvedValue(true);
    app = await buildApp();

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get(`/permissions/clients/${CLIENT_ID}/products/leadflow/access`)
      .expect(403);

    expect(assertCan).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID }),
      LEADFLOW_ADMIN,
    );
    expect(canAccessClientProduct).not.toHaveBeenCalled();
    expect(listClientProductAccess).not.toHaveBeenCalled();
  });

  it('5: social + social manage, but canAccessClientProduct(social) fails → 403', async () => {
    assertCan.mockImplementation(assertCanHolding(SOCIAL_ADMIN));
    canAccessClientProduct.mockResolvedValue(false);
    app = await buildApp();

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get(
        `/permissions/clients/${OTHER_TENANT_CLIENT_ID}/products/social/access`,
      )
      .expect(403);

    expect(canAccessClientProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        clientId: OTHER_TENANT_CLIENT_ID,
        productKey: 'social',
      }),
    );
    expect(listClientProductAccess).not.toHaveBeenCalled();
  });

  it('6: leadflow + leadflow manage, but canAccessClientProduct(leadflow) fails → 403', async () => {
    assertCan.mockImplementation(assertCanHolding(LEADFLOW_ADMIN));
    canAccessClientProduct.mockResolvedValue(false);
    app = await buildApp();

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get(
        `/permissions/clients/${OTHER_TENANT_CLIENT_ID}/products/leadflow/access`,
      )
      .expect(403);

    expect(canAccessClientProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        clientId: OTHER_TENANT_CLIENT_ID,
        productKey: 'leadflow',
      }),
    );
    expect(listClientProductAccess).not.toHaveBeenCalled();
  });

  it('7: no corresponding permission at all (neither key held) → 403', async () => {
    assertCan.mockImplementation(assertCanHolding());
    app = await buildApp('member');

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get(`/permissions/clients/${CLIENT_ID}/products/social/access`)
      .expect(403);

    expect(canAccessClientProduct).not.toHaveBeenCalled();
    expect(listClientProductAccess).not.toHaveBeenCalled();
  });

  it('8: unknown productKey → 400 before any authorization check', async () => {
    app = await buildApp();

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get(`/permissions/clients/${CLIENT_ID}/products/not-a-product/access`)
      .expect(400);

    expect(assertCan).not.toHaveBeenCalled();
    expect(canAccessClientProduct).not.toHaveBeenCalled();
  });

  it('9: the productKey passed to listClientProductAccess is exactly the one requested', async () => {
    assertCan.mockImplementation(
      assertCanHolding(SOCIAL_ADMIN, LEADFLOW_ADMIN),
    );
    canAccessClientProduct.mockResolvedValue(true);
    listClientProductAccess.mockResolvedValue([]);
    app = await buildApp();

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get(`/permissions/clients/${CLIENT_ID}/products/leadflow/access`)
      .expect(200);

    expect(listClientProductAccess).toHaveBeenCalledWith(
      TENANT_ID,
      CLIENT_ID,
      'leadflow',
    );
    expect(listClientProductAccess).not.toHaveBeenCalledWith(
      TENANT_ID,
      CLIENT_ID,
      'social',
    );
  });

  it('10: Social grants and LeadFlow grants stay isolated per request (no cross-product leakage in the response)', async () => {
    assertCan.mockImplementation(
      assertCanHolding(SOCIAL_ADMIN, LEADFLOW_ADMIN),
    );
    canAccessClientProduct.mockResolvedValue(true);
    listClientProductAccess.mockImplementation(
      (_tenantId: string, _clientId: string, productKey: string) =>
        Promise.resolve(
          productKey === 'social'
            ? [{ userId: 'social-user', roleKey: 'admin' }]
            : [{ userId: 'leadflow-user', roleKey: 'operator' }],
        ),
    );
    app = await buildApp();

    const socialResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get(`/permissions/clients/${CLIENT_ID}/products/social/access`)
      .expect(200);

    const leadflowResponse = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get(`/permissions/clients/${CLIENT_ID}/products/leadflow/access`)
      .expect(200);

    expect(socialResponse.body).toEqual({
      clientId: CLIENT_ID,
      productKey: 'social',
      access: [{ userId: 'social-user', roleKey: 'admin' }],
    });
    expect(leadflowResponse.body).toEqual({
      clientId: CLIENT_ID,
      productKey: 'leadflow',
      access: [{ userId: 'leadflow-user', roleKey: 'operator' }],
    });
  });
});
