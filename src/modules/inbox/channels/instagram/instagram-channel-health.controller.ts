import {
  BadRequestException,
  Controller,
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
import { InstagramChannelHealthService } from './services/instagram-channel-health.service';

@Controller('inbox/channels/instagram')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class InstagramChannelHealthController {
  constructor(
    private readonly instagramChannelHealthService: InstagramChannelHealthService,
  ) {}

  @Post(':channelId/health-check')
  @RequirePermission('leadflow.channels.channel.update.admin')
  async healthCheck(
    @RequestContextData() ctx: RequestContext,
    @Param('channelId') channelId: string,
  ) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    return this.instagramChannelHealthService.runHealthCheck({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      channelId,
    });
  }
}
