import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { InboxOutboxRelayService } from './services/inbox-outbox-relay.service';

@Controller('inbox/admin/outbox')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
@RequirePermission('leadflow.channels.channel.update.admin')
export class InboxOutboxAdminController {
  constructor(private readonly relay: InboxOutboxRelayService) {}

  @Get()
  inspect(
    @RequestContextData() ctx: RequestContext,
    @Query('status') status?: string,
    @Query('eventName') eventName?: string,
    @Query('limit') rawLimit?: string,
  ) {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    const allowedStatuses = new Set([
      'pending',
      'processing',
      'published',
      'skipped',
      'dead_letter',
    ]);
    if (status && !allowedStatuses.has(status)) {
      throw new BadRequestException('Invalid outbox status filter.');
    }
    const parsedLimit = rawLimit ? Number(rawLimit) : undefined;
    return this.relay.inspect(ctx.tenantId, ctx.workspaceId, {
      status,
      eventName: eventName?.trim().slice(0, 120) || undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
    });
  }

  @Post(':id/reprocess')
  reprocess(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) eventId: string,
  ) {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    return this.relay.reprocess(
      ctx.tenantId,
      ctx.workspaceId,
      eventId,
      ctx.userId,
    );
  }
}
