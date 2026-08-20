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
import type { FacebookLoginCallbackRouterService } from '../../../meta/oauth/facebook-login-callback-router.service';
import { FacebookInstagramOAuthController } from './facebook-instagram-oauth.controller';
import type { FacebookInstagramOAuthService } from './facebook-instagram-oauth.service';

describe('FacebookInstagramOAuthController', () => {
  const oauthService = {
    start: jest.fn(),
    handleCallback: jest.fn(),
    select: jest.fn(),
    getSessionAssets: jest.fn(),
  };
  const callbackRouter = {
    handleCallback: jest.fn(),
  };
  const controller = new FacebookInstagramOAuthController(
    oauthService as unknown as FacebookInstagramOAuthService,
    callbackRouter as unknown as FacebookLoginCallbackRouterService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('protects start, select, and session assets with authentication, entitlement, and permission', () => {
    for (const handler of [
      FacebookInstagramOAuthController.prototype.start,
      FacebookInstagramOAuthController.prototype.select,
      FacebookInstagramOAuthController.prototype.getSessionAssets,
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
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        FacebookInstagramOAuthController.prototype.callback,
      ),
    ).toBeUndefined();
  });

  it('exposes session assets through the expected GET route', () => {
    const handler = FacebookInstagramOAuthController.prototype.getSessionAssets;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      'session/:sessionId/assets',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.GET,
    );
  });

  it('requires tenant and workspace context on start', () => {
    expect(() => controller.start({ tenantId: 'tenant-id' })).toThrow(
      BadRequestException,
    );
    expect(oauthService.start).not.toHaveBeenCalled();
  });

  it('requires tenant and workspace context on selection', () => {
    expect(() =>
      controller.select(
        { tenantId: 'tenant-id', userId: 'user-id' },
        { sessionId: 'session-id', pageId: '123' },
      ),
    ).toThrow(BadRequestException);
    expect(oauthService.select).not.toHaveBeenCalled();
  });

  it.each([
    ['tenant', { workspaceId: 'workspace-id', userId: 'user-id' }],
    ['workspace', { tenantId: 'tenant-id', userId: 'user-id' }],
  ])('requires %s context for session assets', (_scope, ctx) => {
    expect(() =>
      controller.getSessionAssets(ctx as never, 'session-id'),
    ).toThrow(BadRequestException);
    expect(oauthService.getSessionAssets).not.toHaveBeenCalled();
  });

  it('selects only with authenticated request context ownership', () => {
    void controller.select(
      {
        tenantId: 'tenant-id',
        workspaceId: 'workspace-id',
        userId: 'user-id',
      },
      { sessionId: 'session-id', pageId: '123' },
    );

    expect(oauthService.select).toHaveBeenCalledWith({
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
      userId: 'user-id',
      sessionId: 'session-id',
      pageId: '123',
    });
  });

  it('loads assets only with authenticated request context ownership', () => {
    void controller.getSessionAssets(
      {
        tenantId: 'tenant-id',
        workspaceId: 'workspace-id',
        userId: 'user-id',
      },
      'session-id',
    );

    expect(oauthService.getSessionAssets).toHaveBeenCalledWith({
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
      userId: 'user-id',
      sessionId: 'session-id',
    });
  });

  it('uses only authenticated request context and preserves managed metadata', () => {
    const ctx = {
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
    } as never;

    void controller.start(ctx);

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

  it('redirects the public callback to the routed safe URL', async () => {
    callbackRouter.handleCallback.mockResolvedValue(
      'https://leadflow.example.com/leadflow/inbox/settings/oauth/instagram?status=select_asset&session=session-id',
    );
    const response = { redirect: jest.fn() };

    await controller.callback(
      'code',
      'state',
      undefined,
      undefined,
      undefined,
      response as never,
    );

    expect(oauthService.handleCallback).not.toHaveBeenCalled();
    expect(callbackRouter.handleCallback).toHaveBeenCalledWith({
      code: 'code',
      state: 'state',
      error: undefined,
      errorReason: undefined,
      errorDescription: undefined,
    });
    expect(response.redirect).toHaveBeenCalledWith(
      302,
      'https://leadflow.example.com/leadflow/inbox/settings/oauth/instagram?status=select_asset&session=session-id',
    );
  });
});
