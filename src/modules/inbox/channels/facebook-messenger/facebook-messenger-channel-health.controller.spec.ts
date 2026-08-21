/* eslint-disable @typescript-eslint/unbound-method -- Nest metadata and controller double */
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../../../permissions/decorators/permissions.decorators';
import { PermissionsGuard } from '../../../permissions/guards/permissions.guard';
import { FacebookMessengerChannelHealthController } from './facebook-messenger-channel-health.controller';
import type { FacebookMessengerChannelHealthService } from './services/facebook-messenger-channel-health.service';

describe('FacebookMessengerChannelHealthController', () => {
  const healthService = { runHealthCheck: jest.fn() };
  const controller = new FacebookMessengerChannelHealthController(
    healthService as unknown as FacebookMessengerChannelHealthService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('requires auth, LeadFlow entitlement and channel update permission', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        FacebookMessengerChannelHealthController,
      ),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        FacebookMessengerChannelHealthController,
      ),
    ).toBe('leadflow');
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        FacebookMessengerChannelHealthController.prototype.healthCheck,
      ),
    ).toBe('leadflow.channels.channel.update.admin');
  });

  it('passes only resolved tenant/workspace context and channelId', async () => {
    healthService.runHealthCheck.mockResolvedValue({ ok: true });

    await controller.healthCheck(
      { tenantId: 'tenant-id', workspaceId: 'workspace-id' },
      'channel-id',
    );

    expect(healthService.runHealthCheck).toHaveBeenCalledWith({
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
      channelId: 'channel-id',
    });
  });

  it('requires tenant and workspace context', async () => {
    await expect(
      controller.healthCheck({ tenantId: 'tenant-id' }, 'channel-id'),
    ).rejects.toThrow(BadRequestException);
    expect(healthService.runHealthCheck).not.toHaveBeenCalled();
  });
});
