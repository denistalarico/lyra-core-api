/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method -- Nest reflection and Jest controller doubles expose framework-owned dynamic metadata. */
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../../../auth/guards/jwt-auth.guard';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../../../../permissions/decorators/permissions.decorators';
import { PermissionsGuard } from '../../../../permissions/guards/permissions.guard';
import { InstagramOAuthController } from './instagram-oauth.controller';
import type { InstagramOAuthService } from './instagram-oauth.service';

describe('InstagramOAuthController', () => {
  const oauthService = {
    start: jest.fn(),
    handleCallback: jest.fn(),
  };
  const controller = new InstagramOAuthController(
    oauthService as unknown as InstagramOAuthService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('protects start with JWT, entitlement, and channel creation permission', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      InstagramOAuthController.prototype.start,
    );

    expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        InstagramOAuthController.prototype.start,
      ),
    ).toBe('leadflow');
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        InstagramOAuthController.prototype.start,
      ),
    ).toBe('leadflow.channels.channel.create.admin');
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        InstagramOAuthController.prototype.callback,
      ),
    ).toBeUndefined();
  });

  it('requires tenant and workspace context on start', () => {
    expect(() => controller.start({ tenantId: 'tenant-id' })).toThrow(
      BadRequestException,
    );
    expect(oauthService.start).not.toHaveBeenCalled();
  });

  it('redirects the public callback to the service safe URL', async () => {
    oauthService.handleCallback.mockResolvedValue(
      'https://leadflow.example.com/leadflow/inbox/settings/oauth/instagram?status=connected',
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
      'https://leadflow.example.com/leadflow/inbox/settings/oauth/instagram?status=connected',
    );
  });
});
