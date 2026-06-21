import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../../../permissions';
import { WhatsAppChannelHealthService } from './services/whatsapp-channel-health.service';

@Controller('inbox/channels/whatsapp')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class WhatsAppChannelHealthController {
  constructor(
    private readonly whatsappChannelHealthService: WhatsAppChannelHealthService,
  ) {}

  @Get('status')
  @RequirePermission('leadflow.channels.channel.view.client')
  async status(
    @RequestContextData() ctx: RequestContext,
  ) {
    const { tenantId, workspaceId } = ctx;

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
  @RequirePermission('leadflow.channels.channel.view.client')
  async health(
    @RequestContextData() ctx: RequestContext,
    @Param('channelId') channelId: string,
  ) {
    const { tenantId, workspaceId } = ctx;

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
  @RequirePermission('leadflow.channels.channel.update.admin')
  async healthCheck(
    @RequestContextData() ctx: RequestContext,
    @Param('channelId') channelId: string,
  ) {
    const { tenantId, workspaceId } = ctx;

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
