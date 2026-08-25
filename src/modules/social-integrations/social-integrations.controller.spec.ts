/* eslint-disable @typescript-eslint/require-await -- controller test doubles expose partial service shapes. */
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../common/context/request-context.interface';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';
import type { MetaAdsOAuthService } from './services/meta-ads-oauth.service';
import type { SocialAdConnectionService } from './services/social-ad-connection.service';
import { SocialIntegrationsController } from './social-integrations.controller';

const GUARDED_HANDLERS = [
  'connectMetaAds',
  'selectMetaAdsAccount',
  'listConnections',
  'disconnect',
] as const;

function createHarness() {
  const selectInputs: Record<string, unknown>[] = [];

  const oauth = {
    start: jest.fn(async () => ({
      connectionId: 'connection-id',
      authorizationUrl: 'https://www.facebook.com/v25.0/dialog/oauth?x=1',
      expiresAt: new Date().toISOString(),
    })),
    select: jest.fn((input: Record<string, unknown>) => {
      selectInputs.push(input);
      return Promise.resolve({ id: 'connection-id' });
    }),
    handleCallback: jest.fn(
      async () => 'https://agency.example.com/social/settings',
    ),
  };

  const connections = {
    list: jest.fn(async () => [{ id: 'connection-id' }]),
    disconnect: jest.fn(async () => ({ id: 'connection-id' })),
  };

  const controller = new SocialIntegrationsController(
    oauth as unknown as MetaAdsOAuthService,
    connections as unknown as SocialAdConnectionService,
  );

  return { controller, oauth, connections, selectInputs };
}

function context(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    userId: 'user-a',
    ...overrides,
  };
}

describe('SocialIntegrationsController metadata', () => {
  it.each(GUARDED_HANDLERS)(
    '%s requires the social entitlement and the integrations permission',
    (handler) => {
      const target = (
        SocialIntegrationsController.prototype as unknown as Record<
          string,
          () => unknown
        >
      )[handler];

      expect(Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, target)).toBe(
        'social',
      );
      expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, target)).toBe(
        'social.settings.integrations.manage.admin',
      );
    },
  );

  it('leaves the provider callback unguarded, since it carries no session', () => {
    const target = (
      SocialIntegrationsController.prototype as unknown as Record<
        string,
        () => unknown
      >
    ).metaAdsCallback;

    expect(
      Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, target),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(PERMISSION_KEY_METADATA, target),
    ).toBeUndefined();
  });
});

describe('SocialIntegrationsController scope resolution', () => {
  it('binds a connection to the client of the resolved managed context', async () => {
    const harness = createHarness();

    await harness.controller.connectMetaAds(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-a',
          managedTenantId: 'managed-a',
        },
      }),
    );

    expect(harness.oauth.start).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: 'client-a',
      }),
    );
  });

  it('binds to no client in agency mode', async () => {
    const harness = createHarness();

    await harness.controller.connectMetaAds(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'agency',
          clientId: null,
          managedTenantId: null,
        },
      }),
    );

    expect(harness.oauth.start).toHaveBeenCalledWith(
      expect.objectContaining({ agencyClientId: null }),
    );
  });

  it('ignores a client id supplied in the request body', async () => {
    const harness = createHarness();

    await harness.controller.selectMetaAdsAccount(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-a',
          managedTenantId: 'managed-a',
        },
      }),
      {
        connectionId: '11111111-1111-4111-8111-111111111111',
        externalAccountId: 'act_1234567890',
        // A body field the DTO does not declare; the global ValidationPipe
        // rejects it in production, and nothing reads it here either.
        agencyClientId: 'client-b',
      } as never,
    );

    const call = harness.selectInputs[0];

    expect(call).not.toHaveProperty('agencyClientId');
    expect(call.tenantId).toBe('tenant-a');
  });

  it('refuses a request without tenant or workspace context', async () => {
    const harness = createHarness();

    await expect(
      harness.controller.listConnections(context({ workspaceId: undefined })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses client mode without a resolved client', async () => {
    const harness = createHarness();

    await expect(
      harness.controller.listConnections(
        context({
          managedContext: {
            productKey: 'social',
            operatingMode: 'client',
            clientId: null,
            managedTenantId: null,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('passes the caller scope to the disconnect lookup', async () => {
    const harness = createHarness();

    await harness.controller.disconnect(
      context({
        managedContext: {
          productKey: 'social',
          operatingMode: 'client',
          clientId: 'client-a',
          managedTenantId: 'managed-a',
        },
      }),
      '11111111-1111-4111-8111-111111111111',
    );

    expect(harness.connections.disconnect).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      connectionId: '11111111-1111-4111-8111-111111111111',
    });
  });
});
