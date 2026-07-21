import {
  BadRequestException,
  Controller,
  Get,
  Post,
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
import { InboxAutonomyAdminService } from './services/inbox-autonomy-admin.service';

@Controller('inbox/admin/autonomy')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
@RequirePermission('leadflow.channels.channel.update.admin')
export class InboxAutonomyAdminController {
  constructor(private readonly service: InboxAutonomyAdminService) {}

  @Get()
  inspect(@RequestContextData() ctx: RequestContext) {
    if (!ctx.workspaceId)
      throw new BadRequestException('Workspace context is required.');
    return this.service.inspect(ctx.tenantId, ctx.workspaceId);
  }

  @Post('pause')
  pause(@RequestContextData() ctx: RequestContext) {
    if (!ctx.workspaceId)
      throw new BadRequestException('Workspace context is required.');
    return this.service.setEffects(
      ctx.tenantId,
      ctx.workspaceId,
      false,
      ctx.userId,
    );
  }

  @Post('resume')
  resume(@RequestContextData() ctx: RequestContext) {
    if (!ctx.workspaceId)
      throw new BadRequestException('Workspace context is required.');
    return this.service.setEffects(
      ctx.tenantId,
      ctx.workspaceId,
      true,
      ctx.userId,
    );
  }
}
