/* eslint-disable @typescript-eslint/unbound-method -- Nest reflection and Jest controller doubles expose framework-owned dynamic metadata. */
import { BadRequestException, RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../../../../auth/guards/jwt-auth.guard';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../../../../../permissions/decorators/permissions.decorators';
import { PermissionsGuard } from '../../../../../permissions/guards/permissions.guard';
import { FacebookMessengerOAuthController } from './facebook-messenger-oauth.controller';
import type { FacebookMessengerOAuthService } from './facebook-messenger-oauth.service';

describe('FacebookMessengerOAuthController', () => {
  const oauthService = {
    start: jest.fn(),
    select: jest.fn(),
    getSessionAssets: jest.fn(),
  };
  const controller = new FacebookMessengerOAuthController(
    oauthService as unknown as FacebookMessengerOAuthService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('protects start, select, and session assets with the Instagram-equivalent authorization', () => {
    for (const handler of [
      FacebookMessengerOAuthController.prototype.start,
      FacebookMessengerOAuthController.prototype.select,
      FacebookMessengerOAuthController.prototype.getSessionAssets,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
        JwtAuthGuard,
        PermissionsGuard,
      ]);
      expect(Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, handler)).toBe(
        'leadflow',
      );
      expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, handler)).toBe(
        'leadflow.channels.channel.create.admin',
      );
    }
  });

  it('is mounted on a Messenger-specific route prefix', () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, FacebookMessengerOAuthController),
    ).toBe('inbox/channels/facebook-messenger/oauth/facebook');
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        FacebookMessengerOAuthController.prototype.getSessionAssets,
      ),
    ).toBe('session/:sessionId/assets');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        FacebookMessengerOAuthController.prototype.getSessionAssets,
      ),
    ).toBe(RequestMethod.GET);
  });

  it('does not expose its own OAuth callback', () => {
    expect(
      (
        FacebookMessengerOAuthController.prototype as unknown as Record<
          string,
          unknown
        >
      ).callback,
    ).toBeUndefined();
  });

  it.each([
    ['tenant', { workspaceId: 'workspace-id', userId: 'user-id' }],
    ['workspace', { tenantId: 'tenant-id', userId: 'user-id' }],
  ])('requires %s context on every authenticated handler', (_scope, ctx) => {
    expect(() => controller.start(ctx as never)).toThrow(BadRequestException);
    expect(() =>
      controller.select(ctx as never, {
        sessionId: 'session-id',
        pageId: '123',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      controller.getSessionAssets(ctx as never, 'session-id'),
    ).toThrow(BadRequestException);
    expect(oauthService.start).not.toHaveBeenCalled();
    expect(oauthService.select).not.toHaveBeenCalled();
    expect(oauthService.getSessionAssets).not.toHaveBeenCalled();
  });

  it('uses only authenticated request context and preserves managed metadata', () => {
    void controller.start({
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
      userId: 'user-id',
      managedContext: {
        productKey: 'leadflow',
        operatingMode: 'managed',
        clientId: 'client-id',
        clientName: 'Client Name',
        managedTenantId: 'managed-tenant-id',
      },
    } as never);

    expect(oauthService.start).toHaveBeenCalledWith({
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
      userId: 'user-id',
      metadata: {
        setupSource: 'facebook_login',
        productKey: 'leadflow',
        operatingMode: 'managed',
        clientId: 'client-id',
        clientName: 'Client Name',
        managedTenantId: 'managed-tenant-id',
      },
    });
  });

  it('selects and loads assets only with authenticated context ownership', () => {
    const ctx = {
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
      userId: 'user-id',
    } as never;

    void controller.select(ctx, { sessionId: 'session-id', pageId: '123' });
    void controller.getSessionAssets(ctx, 'session-id');

    expect(oauthService.select).toHaveBeenCalledWith({
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
      userId: 'user-id',
      sessionId: 'session-id',
      pageId: '123',
    });
    expect(oauthService.getSessionAssets).toHaveBeenCalledWith({
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
      userId: 'user-id',
      sessionId: 'session-id',
    });
  });
});
