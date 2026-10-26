import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { CLIENT_AREA_EXPOSED_METADATA } from '../../common/client-area-bridge/client-area-bridge.registry';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ANY_PERMISSION_KEYS_METADATA,
  PERMISSION_KEY_METADATA,
  PermissionsGuard,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions';
import { AnalyticsOverviewHeaderController } from './analytics-overview-header.controller';

const TENANT = '10000000-0000-4000-8000-000000000001';
const WORKSPACE = '20000000-0000-4000-8000-000000000001';
const CLIENT = '30000000-0000-4000-8000-000000000001';
const COMPANY = '31000000-0000-4000-8000-000000000001';
const USER = '50000000-0000-4000-8000-000000000001';

const agencyCtx: RequestContext = {
  tenantId: TENANT,
  workspaceId: WORKSPACE,
  userId: USER,
  role: 'operator',
};

function clientCtx(productKey: 'agency' | 'leadflow' | 'social') {
  return {
    ...agencyCtx,
    managedContext: {
      productKey,
      operatingMode: 'client',
      clientId: CLIENT,
      companyContextId: COMPANY,
      managedTenantId: null,
    },
  } satisfies RequestContext;
}

function build(products: string[] = ['leadflow', 'social']) {
  const service = {
    get: jest.fn().mockResolvedValue({ title: 'Visão Geral' }),
    update: jest.fn().mockResolvedValue({ title: 'Novo' }),
  };
  const permissions = {
    canAccessProduct: jest.fn((_ctx: unknown, product: string) =>
      Promise.resolve(products.includes(product)),
    ),
  };
  return {
    controller: new AnalyticsOverviewHeaderController(
      service as never,
      permissions as never,
    ),
    service,
    permissions,
  };
}

// Handlers read off the prototype only to inspect decorator metadata.
function handler(name: 'get' | 'update'): object {
  return Object.getOwnPropertyDescriptor(
    AnalyticsOverviewHeaderController.prototype,
    name,
  )?.value as object;
}

describe('AnalyticsOverviewHeaderController — route metadata', () => {
  it.each([
    ['get', handler('get')],
    ['update', handler('update')],
  ])('%s runs behind JwtAuthGuard + PermissionsGuard', (_name, handler) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
    ]);
  });

  it('GET accepts the read key of either product', () => {
    expect(
      Reflect.getMetadata(ANY_PERMISSION_KEYS_METADATA, handler('get')),
    ).toEqual([
      'leadflow.analytics.reports.view.operational',
      'social.analytics.reports.view.operational',
    ]);
  });

  it('PATCH accepts the manage key of either product, never a read key', () => {
    expect(
      Reflect.getMetadata(ANY_PERMISSION_KEYS_METADATA, handler('update')),
    ).toEqual([
      'leadflow.analytics.reports.view.full',
      'social.analytics.dashboards.manage.admin_or_explicit',
    ]);
  });

  it.each([
    ['get', handler('get')],
    ['update', handler('update')],
  ])(
    '%s pins no single product, single permission or Client Area exposure',
    (_name, handler) => {
      expect(
        Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, handler),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(PERMISSION_KEY_METADATA, handler),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(CLIENT_AREA_EXPOSED_METADATA, handler),
      ).toBeUndefined();
    },
  );
});

describe('AnalyticsOverviewHeaderController — product scope', () => {
  it('agency root: reads when the tenant has only Social', async () => {
    const { controller, service } = build(['social']);

    await controller.get(agencyCtx);

    expect(service.get).toHaveBeenCalledWith({
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      agencyClientId: null,
      companyContextId: null,
    });
  });

  it('agency root: writes when the tenant has only LeadFlow, with the actor', async () => {
    const { controller, service } = build(['leadflow']);

    await controller.update(agencyCtx, { title: 'Novo' });

    expect(service.update).toHaveBeenCalledWith(
      expect.objectContaining({ agencyClientId: null }),
      USER,
      { title: 'Novo' },
    );
  });

  it('agency root: refuses when the tenant has neither product', async () => {
    const { controller, service } = build([]);

    await expect(controller.get(agencyCtx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      controller.update(agencyCtx, { title: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.get).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
  });

  it.each(['leadflow', 'social'] as const)(
    'client mode (%s): uses the company scope and relies on the guard product check',
    async (product) => {
      const { controller, service, permissions } = build([]);

      await controller.get(clientCtx(product));

      expect(permissions.canAccessProduct).not.toHaveBeenCalled();
      expect(service.get).toHaveBeenCalledWith({
        tenantId: TENANT,
        workspaceId: WORKSPACE,
        agencyClientId: CLIENT,
        companyContextId: COMPANY,
      });
    },
  );

  it('client mode with a non-Analytics product header is refused', async () => {
    const { controller, service } = build();

    await expect(controller.get(clientCtx('agency'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      controller.update(clientCtx('agency'), { title: 'x' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.get).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
  });
});
