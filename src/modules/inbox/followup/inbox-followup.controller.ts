import { ClientAreaExposed } from '../../client-area/client-area.decorators';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  RequireProductEntitlement,
} from '../../permissions';
import {
  CreateInboxFollowupTemplateDto,
  SendInboxFollowupDto,
  UpdateInboxFollowupTemplateDto,
} from '../dto/inbox-followup.dto';
import { InboxFollowupTemplatesService } from './inbox-followup-templates.service';
import { InboxFollowupService } from './inbox-followup.service';

/**
 * Assisted follow-up (IX2): the Lyra templates, the conversation's messaging
 * window as the composer needs it, and the one-click send of a pending step.
 * Permissions mirror the existing surfaces: templates as Inbox settings, the
 * send as a reply.
 *
 * Exposed to the Client Area too (the Inbox is used mostly by the companies):
 * the bridge proves each route in `leadflow-client-area.routes.ts` and the
 * scope service — templates by `inbox_followup_templates` company row, window
 * and send by the conversation, operators only on their assignment.
 */
@Controller('inbox')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class InboxFollowupController {
  constructor(
    private readonly templates: InboxFollowupTemplatesService,
    private readonly followup: InboxFollowupService,
  ) {}

  @ClientAreaExposed('leadflow_inbox')
  @Get('followup-templates')
  @RequireAnyPermission(
    'leadflow.settings.general.view.admin',
    'leadflow.inbox.conversation.view.assigned',
    'leadflow.inbox.conversation.view.client',
    'leadflow.inbox.conversation.view.all',
  )
  listTemplates(@RequestContextData() ctx: RequestContext) {
    return this.templates.list(ctx);
  }

  @ClientAreaExposed('leadflow_inbox')
  @Post('followup-templates')
  @RequirePermission('leadflow.settings.general.update.admin')
  createTemplate(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateInboxFollowupTemplateDto,
  ) {
    return this.templates.create(ctx, dto);
  }

  @ClientAreaExposed('leadflow_inbox')
  @Patch('followup-templates/:id')
  @RequirePermission('leadflow.settings.general.update.admin')
  updateTemplate(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInboxFollowupTemplateDto,
  ) {
    return this.templates.update(ctx, id, dto);
  }

  @ClientAreaExposed('leadflow_inbox')
  @Delete('followup-templates/:id')
  @RequirePermission('leadflow.settings.general.update.admin')
  removeTemplate(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.templates.remove(ctx, id);
  }

  @ClientAreaExposed('leadflow_inbox')
  @Get('conversations/:id/messaging-window')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.view.assigned',
    'leadflow.inbox.conversation.view.client',
    'leadflow.inbox.conversation.view.all',
  )
  messagingWindow(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.followup.getMessagingWindow(ctx, id);
  }

  @ClientAreaExposed('leadflow_inbox')
  @Post('conversations/:id/followup/send')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.reply.assigned',
    'leadflow.inbox.conversation.reply.client',
  )
  sendFollowUp(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendInboxFollowupDto,
  ) {
    return this.followup.send(ctx, id, dto);
  }
}
