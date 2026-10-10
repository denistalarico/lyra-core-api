import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FinanceAiCostQueryDto } from '../finance/dto/finance-ai-cost.dto';
import { PERMISSION_KEYS } from '../permissions/catalog/permission-keys.catalog';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { CreativeCostController } from './creative-cost.controller';
import { CREATIVE_PRODUCTION_PERMISSIONS } from './creative-production.permissions';

const clientCtx = {
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
const scopeA = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  companyContextId: 'company-a',
};

describe('Creative cost controller (CS6-B)', () => {
  it('applies JWT, permission and Social entitlement guards', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, CreativeCostController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, CreativeCostController),
    ).toBe('social');
  });

  it.each(['contentCosts', 'versionCosts', 'reconcile'])(
    '%s carries the Studio view key; money needs the Finance key in the service',
    (handlerName) => {
      const handler = (
        CreativeCostController.prototype as unknown as Record<
          string,
          () => unknown
        >
      )[handlerName];
      expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, handler)).toBe(
        'social.creative.content.view.assigned',
      );
    },
  );

  it('reuses the existing Finance profitability key (no new key)', () => {
    expect(CREATIVE_PRODUCTION_PERMISSIONS.costView).toBe(
      'agency.finance.profitability.view.finance_or_owner',
    );
    expect(PERMISSION_KEYS).toContain(CREATIVE_PRODUCTION_PERMISSIONS.costView);
  });

  it('takes scope only from the request context', async () => {
    const costs = {
      contentCosts: jest.fn(async () => ({})),
      versionCosts: jest.fn(async () => ({})),
      reconcile: jest.fn(async () => ({})),
    };
    const controller = new CreativeCostController(costs as never);
    await controller.contentCosts(clientCtx, 'content-a');
    await controller.versionCosts(clientCtx, 'asset-a', 'version-a');
    await controller.reconcile(clientCtx);
    expect(costs.contentCosts).toHaveBeenCalledWith(
      clientCtx,
      scopeA,
      'content-a',
    );
    expect(costs.versionCosts).toHaveBeenCalledWith(
      clientCtx,
      scopeA,
      'asset-a',
      'version-a',
    );
    expect(costs.reconcile).toHaveBeenCalledWith(clientCtx, scopeA);
  });

  it('validates the Finance drill-down query', async () => {
    const errors = async (query: object) =>
      (await validate(plainToInstance(FinanceAiCostQueryDto, query))).map(
        (e) => e.property,
      );
    expect(await errors({})).toEqual([]);
    expect(
      await errors({
        clientId: 'nope',
        startDate: 'yesterday',
        limit: '500',
      }),
    ).toEqual(['startDate', 'clientId', 'limit']);
    expect(
      await errors({ internal: 'true', projectId: scopeA.tenantId }),
    ).toEqual(['projectId']);
  });
});
