import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  SOCIAL_TOGGLEABLE_CHANNELS,
  type SocialToggleableChannel,
} from './social-channel-preference.entity';
import { SocialChannelPreferencesService } from './social-channel-preferences.service';

export class SetSocialChannelPreferenceDto {
  @IsBoolean() enabled!: boolean;
}

const CHANNELS = Object.fromEntries(
  SOCIAL_TOGGLEABLE_CHANNELS.map((channel) => [channel, channel]),
);

@Controller('social/channel-preferences')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class SocialChannelPreferencesController {
  constructor(private readonly preferences: SocialChannelPreferencesService) {}

  /** Read by every Social surface that offers channels, so entitlement only. */
  @Get()
  async list(@RequestContextData() ctx: RequestContext) {
    return {
      disabled: await this.preferences.disabled(resolveCompanyAwareScope(ctx)),
    };
  }

  /** Switched from the integrations cards. */
  @Put(':channel')
  @RequirePermission('social.settings.integrations.manage.admin')
  async set(
    @RequestContextData() ctx: RequestContext,
    @Param('channel', new ParseEnumPipe(CHANNELS))
    channel: SocialToggleableChannel,
    @Body() dto: SetSocialChannelPreferenceDto,
  ) {
    return {
      disabled: await this.preferences.set(
        resolveCompanyAwareScope(ctx),
        channel,
        dto.enabled,
        ctx.userId ?? null,
      ),
    };
  }
}
