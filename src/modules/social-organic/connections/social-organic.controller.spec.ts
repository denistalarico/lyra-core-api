/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method -- controller doubles and metadata inspection intentionally reference methods directly. */
import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import type { RequestContext } from '../../../common/context/request-context.interface';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../../permissions/decorators/permissions.decorators';
import type { SocialOrganicConnectionService } from './social-organic-connection.service';
import { SocialOrganicController } from './social-organic.controller';
import type { SocialOrganicOAuthService } from './social-organic-oauth.service';
import type { MetaOrganicHealthService } from '../providers/meta/meta-organic-health.service';
import type { SocialOrganicSyncRunService } from '../analytics/social-organic-sync-run.service';

function harness() {
  const oauth = {
    start: jest.fn(async () => ({ authorizationUrl: 'https://facebook.test' })),
    select: jest.fn(async () => ({ id: 'connection-1' })),
    handleCallback: jest.fn(async () =>
      Promise.resolve('https://lyrasuite.com/social/settings'),
    ),
  };
  const connections = {
    list: jest.fn(async () => [{ id: 'connection-1' }]),
    disconnect: jest.fn(async () => ({ id: 'connection-1' })),
    updateAssetTimezone: jest.fn(async () => ({
      id: 'asset-1',
      assetTimezone: 'America/Sao_Paulo',
    })),
  };
  const health = {
    checkAsset: jest.fn(
      async (): Promise<{
        assetId: string;
        status: string;
        reason: string;
        checkedAt: Date;
      }> => ({
        assetId: 'asset-1',
        status: 'healthy',
        reason: 'ok',
        checkedAt: new Date('2026-09-08T00:00:00.000Z'),
      }),
    ),
  };
  const analyticsRuns = {
    request: jest.fn(async () => ({
      runId: 'run-1',
      status: 'queued',
      startedAt: null,
      completedAt: null,
      safeReason: null,
      deduplicated: false,
    })),
  };
  return {
    oauth,
    connections,
    health,
    analyticsRuns,
    controller: new SocialOrganicController(
      oauth as unknown as SocialOrganicOAuthService,
      connections as unknown as SocialOrganicConnectionService,
      health as unknown as MetaOrganicHealthService,
      analyticsRuns as unknown as SocialOrganicSyncRunService,
    ),
  };
}

function context(overrides: Partial<RequestContext> = {}): RequestContext {
  const managedContext = overrides.managedContext;
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    ...overrides,
    ...(managedContext?.operatingMode === 'client' && managedContext.clientId
      ? {
          managedContext: {
            ...managedContext,
            companyContextId: managedContext.companyContextId ?? 'company-1',
          },
        }
      : {}),
  } as RequestContext;
}

describe('SocialOrganicController', () => {
  it('maps the canonical Organic callback route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SocialOrganicController)).toBe(
      'social/organic',
    );
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        SocialOrganicController.prototype.callback,
      ),
    ).toBe('oauth/:provider/callback');
  });

  it.each([
    'list',
    'connect',
    'select',
    'disconnect',
    'checkAssetHealth',
    'updateAssetTimezone',
  ] as const)(
    '31. guards %s with the Social integrations permission',
    (method) => {
      const target = SocialOrganicController.prototype[method];
      expect(Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, target)).toBe(
        'social',
      );
      expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, target)).toBe(
        'social.settings.integrations.manage.admin',
      );
    },
  );

  it('leaves only the provider callback public', () => {
    const target = SocialOrganicController.prototype.callback;
    expect(
      Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, target),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(PERMISSION_KEY_METADATA, target),
    ).toBeUndefined();
  });

  it('guards on-demand analytics with the operational analytics permission', () => {
    const target = SocialOrganicController.prototype.requestAnalyticsSync;
    expect(Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, target)).toBe(
      'social',
    );
    expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, target)).toBe(
      'social.analytics.organic.view.operational',
    );
  });

  it('derives on-demand analytics scope from context and returns safe run fields', async () => {
    const { controller, analyticsRuns } = harness();

    const result = await controller.requestAnalyticsSync(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-1',
          managedTenantId: 'managed-tenant',
        },
      }),
      'asset-1',
      { fromDate: '2026-09-07', toDate: '2026-09-08' },
    );

    expect(analyticsRuns.request).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: 'client-1',
      companyContextId: 'company-1',
      assetId: 'asset-1',
      fromDate: '2026-09-07',
      toDate: '2026-09-08',
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        'runId',
        'status',
        'startedAt',
        'completedAt',
        'safeReason',
        'deduplicated',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(/accessToken|secret-token/);
  });

  it('derives selection scope from managed context, never the body', async () => {
    const { controller, oauth } = harness();
    await controller.select(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-1',
          managedTenantId: 'managed-tenant',
        },
      }),
      'meta',
      {
        connectionId: 'connection-1',
        externalAssetIds: ['page-1'],
        tenantId: 'hostile-tenant',
      } as never,
    );

    expect(oauth.select).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: 'client-1',
      companyContextId: 'company-1',
      userId: 'user-1',
      provider: 'meta',
      connectionId: 'connection-1',
      externalAssetIds: ['page-1'],
    });
  });

  it('redirects callback outcomes without browser session state', async () => {
    const { controller, oauth } = harness();
    const redirect = jest.fn();

    await controller.callback(
      'meta',
      'code',
      'state',
      undefined,
      undefined,
      undefined,
      { redirect } as unknown as Response,
    );

    expect(oauth.handleCallback).toHaveBeenCalledWith({
      provider: 'meta',
      code: 'code',
      state: 'state',
      error: undefined,
      errorReason: undefined,
      errorDescription: undefined,
    });
    expect(redirect).toHaveBeenCalledWith(
      302,
      'https://lyrasuite.com/social/settings',
    );
  });

  it('32. derives the health check scope from context, never a body or query param', async () => {
    const { controller, health } = harness();

    await controller.checkAssetHealth(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-1',
          managedTenantId: 'managed-tenant',
        },
      }),
      'asset-1',
    );

    expect(health.checkAsset).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: 'client-1',
      companyContextId: 'company-1',
      assetId: 'asset-1',
    });
  });

  it('33. returns only safe fields', async () => {
    const { controller } = harness();

    const result = await controller.checkAssetHealth(context(), 'asset-1');

    expect(Object.keys(result).sort()).toEqual(
      ['assetId', 'checkedAt', 'reason', 'status'].sort(),
    );
  });

  it('34. never surfaces a provider raw error in the response', async () => {
    const { controller, health } = harness();
    health.checkAsset.mockResolvedValueOnce({
      assetId: 'asset-1',
      status: 'unhealthy',
      reason: 'asset_unreachable',
      checkedAt: new Date('2026-09-08T00:00:00.000Z'),
    });

    const result = await controller.checkAssetHealth(context(), 'asset-1');

    expect(JSON.stringify(result)).not.toMatch(
      /meta_|graph|provider_metadata/i,
    );
  });

  it('35. propagates a not-found result for a cross-context asset instead of masking it', async () => {
    const { controller, health } = harness();
    health.checkAsset.mockRejectedValueOnce(
      new NotFoundException('Social organic asset not found.'),
    );

    await expect(
      controller.checkAssetHealth(context(), 'asset-1'),
    ).rejects.toThrow('Social organic asset not found.');
  });

  it('36. derives the timezone update scope from context, never a body or query param', async () => {
    const { controller, connections } = harness();

    await controller.updateAssetTimezone(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-1',
          managedTenantId: 'managed-tenant',
        },
      }),
      'asset-1',
      { timezone: 'America/Sao_Paulo' },
    );

    expect(connections.updateAssetTimezone).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: 'client-1',
      companyContextId: 'company-1',
      assetId: 'asset-1',
      timezone: 'America/Sao_Paulo',
    });
  });

  it('37. propagates a not-found result for a cross-context asset instead of masking it', async () => {
    const { controller, connections } = harness();
    connections.updateAssetTimezone.mockRejectedValueOnce(
      new NotFoundException('Social organic asset not found.'),
    );

    await expect(
      controller.updateAssetTimezone(context(), 'asset-1', {
        timezone: 'America/Sao_Paulo',
      }),
    ).rejects.toThrow('Social organic asset not found.');
  });

  it('rejects a missing managed-client identity', () => {
    const { controller } = harness();
    expect(() =>
      controller.connect(
        context({
          managedContext: {
            productKey: 'social',
            operatingMode: 'client',
            clientId: null,
            managedTenantId: null,
          },
        }),
        'meta',
      ),
    ).toThrow(BadRequestException);
  });
});
