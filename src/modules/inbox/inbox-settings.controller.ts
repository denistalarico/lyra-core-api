import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PatchInboxSettingsDto } from './dto/patch-inbox-settings.dto';
import { InboxSettingsService } from './inbox-settings.service';

@Controller('inbox/settings')
@UseGuards(JwtAuthGuard)
export class InboxSettingsController {
  constructor(private readonly inboxSettingsService: InboxSettingsService) {}

  @Get()
  getSettings(@RequestContextData() ctx: RequestContext) {
    return this.inboxSettingsService.getSettings(ctx);
  }

  @Patch()
  patchSettings(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchInboxSettingsDto,
  ) {
    return this.inboxSettingsService.patchSettings(ctx, dto);
  }
}
