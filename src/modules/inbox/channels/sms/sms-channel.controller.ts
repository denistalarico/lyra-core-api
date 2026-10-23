import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import {
  ConnectSmsChannelDto,
  UpdateSmsChannelSettingsDto,
} from './dto/sms.dto';
import { SmsChannelService } from './sms-channel.service';

/**
 * Agency-side setup of the tenant's SMS account, like the other channels'
 * connection flows (none of them is exposed in the Client Area). Disconnect,
 * pause and resume are the generic `/inbox/channels/:id/*` lifecycle.
 */
@Controller('inbox/channels/sms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class SmsChannelController {
  constructor(private readonly smsChannels: SmsChannelService) {}

  @Get('setup')
  @RequirePermission('leadflow.channels.channel.view.client')
  setup() {
    return this.smsChannels.setup();
  }

  @Post('connect')
  @RequirePermission('leadflow.channels.channel.create.admin')
  connect(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: ConnectSmsChannelDto,
  ) {
    return this.smsChannels.connect(ctx, dto);
  }

  @Post(':channelId/health-check')
  @RequirePermission('leadflow.channels.channel.update.admin')
  healthCheck(
    @RequestContextData() ctx: RequestContext,
    @Param('channelId') channelId: string,
  ) {
    return this.smsChannels.healthCheck(ctx, channelId);
  }

  @Patch(':channelId/settings')
  @RequirePermission('leadflow.channels.channel.update.admin')
  updateSettings(
    @RequestContextData() ctx: RequestContext,
    @Param('channelId') channelId: string,
    @Body() dto: UpdateSmsChannelSettingsDto,
  ) {
    return this.smsChannels.updateSettings(ctx, channelId, dto);
  }
}
