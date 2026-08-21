/* eslint-disable @typescript-eslint/unbound-method -- Nest metadata and controller double */
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../../../permissions/decorators/permissions.decorators';
import { PermissionsGuard } from '../../../permissions/guards/permissions.guard';
import { WhatsAppChannelHealthController } from './whatsapp-channel-health.controller';
import type { WhatsAppChannelHealthService } from './services/whatsapp-channel-health.service';

describe('WhatsAppChannelHealthController', () => {
  const healthService = {
    listStatus: jest.fn(),
    getHealth: jest.fn(),
    runHealthCheck: jest.fn(),
  };
  const controller = new WhatsAppChannelHealthController(
    healthService as unknown as WhatsAppChannelHealthService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('requires auth and LeadFlow entitlement, with per-route permissions', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, WhatsAppChannelHealthController),
    ).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        PRODUCT_ENTITLEMENT_METADATA,
        WhatsAppChannelHealthController,
      ),
    ).toBe('leadflow');
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        WhatsAppChannelHealthController.prototype.status,
      ),
    ).toBe('leadflow.channels.channel.view.client');
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        WhatsAppChannelHealthController.prototype.health,
      ),
    ).toBe('leadflow.channels.channel.view.client');
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY_METADATA,
        WhatsAppChannelHealthController.prototype.healthCheck,
      ),
    ).toBe('leadflow.channels.channel.update.admin');
  });

  it('status passes only the resolved tenant/workspace context', async () => {
    healthService.listStatus.mockResolvedValue({ state: 'not_connected' });

    await controller.status({
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
    });

    expect(healthService.listStatus).toHaveBeenCalledWith({
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
    });
  });

  it('status requires tenant and workspace context', async () => {
    await expect(controller.status({ tenantId: 'tenant-id' })).rejects.toThrow(
      BadRequestException,
    );
    expect(healthService.listStatus).not.toHaveBeenCalled();
  });

  it('health passes only resolved tenant/workspace context and channelId', async () => {
    healthService.getHealth.mockResolvedValue({ id: 'channel-id' });

    await controller.health(
      { tenantId: 'tenant-id', workspaceId: 'workspace-id' },
      'channel-id',
    );

    expect(healthService.getHealth).toHaveBeenCalledWith({
      tenantId: 'tenant-id',
      workspaceId: 'workspace-id',
      channelId: 'channel-id',
    });
  });

  it('health requires tenant and workspace context', async () => {
    await expect(
      controller.health({ tenantId: 'tenant-id' }, 'channel-id'),
    ).rejects.toThrow(BadRequestException);
    expect(healthService.getHealth).not.toHaveBeenCalled();
  });

  it('healthCheck passes only resolved tenant/workspace context and channelId', async () => {
    healthService.runHealthCheck.mockResolvedValue({ id: 'channel-id' });

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

  it('healthCheck requires tenant and workspace context', async () => {
    await expect(
      controller.healthCheck({ tenantId: 'tenant-id' }, 'channel-id'),
    ).rejects.toThrow(BadRequestException);
    expect(healthService.runHealthCheck).not.toHaveBeenCalled();
  });
});
