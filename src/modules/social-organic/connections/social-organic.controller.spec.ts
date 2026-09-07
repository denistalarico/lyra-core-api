/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method -- controller doubles and metadata inspection intentionally reference methods directly. */
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
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
  };
  return {
    oauth,
    connections,
    controller: new SocialOrganicController(
      oauth as unknown as SocialOrganicOAuthService,
      connections as unknown as SocialOrganicConnectionService,
    ),
  };
}

function context(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    ...overrides,
  };
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

  it.each(['list', 'connect', 'select', 'disconnect'] as const)(
    'guards %s with the Social integrations permission',
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
