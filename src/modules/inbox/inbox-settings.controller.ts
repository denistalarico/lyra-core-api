import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { PatchInboxSettingsDto } from './dto/patch-inbox-settings.dto';
import { InboxSettingsService } from './inbox-settings.service';

@Controller('inbox/settings')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class InboxSettingsController {
  constructor(private readonly inboxSettingsService: InboxSettingsService) {}

  @Get()
  // Admins manage settings, but Inbox operators (managers/members) also need to
  // read active channels/tags/quick replies to run the Inbox itself.
  @RequireAnyPermission(
    'leadflow.settings.general.view.admin',
    'leadflow.inbox.conversation.view.assigned',
    'leadflow.inbox.conversation.view.client',
    'leadflow.inbox.conversation.view.all',
  )
  getSettings(@RequestContextData() ctx: RequestContext) {
    return this.inboxSettingsService.getSettings(ctx);
  }

  @Patch()
  @RequirePermission('leadflow.settings.general.update.admin')
  patchSettings(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PatchInboxSettingsDto,
  ) {
    return this.inboxSettingsService.patchSettings(ctx, dto);
  }
}
