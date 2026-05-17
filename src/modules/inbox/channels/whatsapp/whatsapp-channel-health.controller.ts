import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { WhatsAppChannelHealthService } from './services/whatsapp-channel-health.service';

@Controller('inbox/channels/whatsapp')
export class WhatsAppChannelHealthController {
  constructor(
    private readonly whatsappChannelHealthService: WhatsAppChannelHealthService,
  ) {}

  @Get('status')
  async status(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('x-workspace-id') workspaceId: string | undefined,
  ) {
    if (!tenantId || !workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    return this.whatsappChannelHealthService.listStatus({
      tenantId,
      workspaceId,
    });
  }

  @Get(':channelId/health')
  async health(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('channelId') channelId: string,
  ) {
    if (!tenantId || !workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    return this.whatsappChannelHealthService.getHealth({
      tenantId,
      workspaceId,
      channelId,
    });
  }

  @Post(':channelId/health-check')
  async healthCheck(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('channelId') channelId: string,
  ) {
    if (!tenantId || !workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    return this.whatsappChannelHealthService.runHealthCheck({
      tenantId,
      workspaceId,
      channelId,
    });
  }
}
