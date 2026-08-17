/* eslint-disable @typescript-eslint/unbound-method -- Nest reflection and Jest controller doubles expose framework-owned dynamic metadata. */
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../../../../auth/guards/jwt-auth.guard';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../../../../../permissions/decorators/permissions.decorators';
import { PermissionsGuard } from '../../../../../permissions/guards/permissions.guard';
import { FacebookInstagramOAuthController } from './facebook-instagram-oauth.controller';
import type { FacebookInstagramOAuthService } from './facebook-instagram-oauth.service';

describe('FacebookInstagramOAuthController', () => {
  const oauthService = {
    start: jest.fn(),
    handleCallback: jest.fn(),
  };
  const controller = new FacebookInstagramOAuthController(
    oauthService as unknown as FacebookInstagramOAuthService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('protects start and keeps the callback public', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        FacebookInstagramOAuthController.prototype.start,
      ),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        FacebookInstagramOAuthController.prototype.start,
      ),
    ).toBe('leadflow');
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        FacebookInstagramOAuthController.prototype.start,
      ),
    ).toBe('leadflow.channels.channel.create.admin');
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        FacebookInstagramOAuthController.prototype.callback,
      ),
    ).toBeUndefined();
  });

  it('requires tenant and workspace context on start', () => {
    expect(() => controller.start({ tenantId: 'tenant-id' })).toThrow(
      BadRequestException,
    );
    expect(oauthService.start).not.toHaveBeenCalled();
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

  it('redirects the public callback to the service safe URL', async () => {
    oauthService.handleCallback.mockResolvedValue(
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

    expect(oauthService.handleCallback).toHaveBeenCalledWith({
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
