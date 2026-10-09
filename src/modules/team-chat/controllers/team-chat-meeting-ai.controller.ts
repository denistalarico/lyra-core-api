import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { TeamChatMeetingAiService } from '../services/team-chat-meeting-ai.service';
import { SaveMeetingAiSettingsDto } from '../dto/meeting-ai.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/team-chat')
export class TeamChatMeetingAiController {
  constructor(private readonly analysis: TeamChatMeetingAiService) {}
  private context(ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId || !ctx.userId)
      throw new ForbiddenException(
        'Contexto autenticado de workspace obrigatório.',
      );
    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      role: ctx.role,
    };
  }

  @Get('meeting-ai/settings/availability')
  @RequirePermission('agency.chat.channels.view.assigned')
  availability(@RequestContextData() ctx: RequestContext) {
    return this.analysis.availability(this.context(ctx));
  }

  @Get('meeting-ai/settings')
  @RequirePermission('agency.settings.apps.manage.admin')
  settings(@RequestContextData() ctx: RequestContext) {
    return this.analysis.getSettings(this.context(ctx));
  }

  @Put('meeting-ai/settings')
  @RequirePermission('agency.settings.apps.manage.admin')
  saveSettings(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SaveMeetingAiSettingsDto,
  ) {
    return this.analysis.saveSettings(this.context(ctx), {
      enabled: dto.enabled,
      expenseAccountId: dto.expenseAccountId ?? null,
      costCenterId: dto.costCenterId ?? null,
      maxCostUsd: dto.maxCostUsd,
      maxCaptureMinutes: dto.maxCaptureMinutes,
      retentionDays: dto.retentionDays,
    });
  }

  @Post('meetings/:meetingId/analysis')
  @RequirePermission('agency.chat.channels.manage_members.assigned')
  start(
    @RequestContextData() ctx: RequestContext,
    @Param('meetingId', ParseUUIDPipe) id: string,
  ) {
    return this.analysis.request(this.context(ctx), id);
  }

  @Get('meetings/:meetingId/analysis')
  @RequirePermission('agency.chat.channels.view.assigned')
  detail(
    @RequestContextData() ctx: RequestContext,
    @Param('meetingId', ParseUUIDPipe) id: string,
  ) {
    return this.analysis.detail(this.context(ctx), id);
  }

  @Get('meetings/:meetingId/analysis/pdf')
  @RequirePermission('agency.chat.channels.view.assigned')
  async pdf(
    @RequestContextData() ctx: RequestContext,
    @Param('meetingId', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const asset = await this.analysis.download(this.context(ctx), id);
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="resumo-reuniao-${id}.pdf"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(asset.body);
  }
}
