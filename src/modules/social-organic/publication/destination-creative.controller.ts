import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../../permissions';
import {
  DestinationCreativeService,
  type DestinationCreativeScope,
} from './destination-creative.service';
import { ReplaceDestinationCreativeDto } from './dto/replace-destination-creative.dto';

/**
 * Choosing which creative each destination publishes (Planner E5).
 *
 * MOUNTED UNDER `/social/planner`, NOT `/social/publishing`
 * --------------------------------------------------------
 * The route follows the resource, not the code layout. These rows are
 * editorial intent hanging off a Planner destination, and they are read by the
 * Planner's content page — so they answer to `social.planner.calendar.*`, the
 * same keys that already govern the destination itself. The service lives in
 * `social-organic` only because capability validation needs the provider
 * registry; that is an implementation detail the URL should not leak.
 *
 * Serving these paths from a controller in this folder is safe because Nest
 * routes by the declared path, not by directory: `SocialPlannerController`
 * declares no `content/:id/creatives` or `destinations/:id/creative` path, so
 * there is nothing for these to collide with.
 *
 * NO CREATE/DELETE SPLIT IN PERMISSIONS
 * -------------------------------------
 * Attaching a creative is an update to existing planned content, not the
 * creation of a new planning object, so both writes require the UPDATE key.
 * `social.planner.calendar.delete.owner_or_admin_explicit` deliberately does
 * NOT gate the removal below: that key is about deleting planned content, and
 * clearing a creative leaves the content and its destination intact.
 */
const VIEW_PERMISSION = 'social.planner.calendar.view.client';
const UPDATE_PERMISSION = 'social.planner.calendar.update.manager';

@Controller('social/planner')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class DestinationCreativeController {
  constructor(
    private readonly destinationCreativeService: DestinationCreativeService,
  ) {}

  @Get('content/:contentId/creatives')
  @RequirePermission(VIEW_PERMISSION)
  list(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    return this.destinationCreativeService.listForContent(
      this.requireScope(ctx),
      contentId,
    );
  }

  /**
   * `PUT`, not `POST`: a destination holds at most one primary creative, so
   * this is idempotent replacement of a known slot rather than the creation of
   * a new one. It mirrors `PUT /content/:contentId/destinations`, which
   * replaces that set for the same reason.
   */
  @Put('destinations/:destinationId/creative')
  @RequirePermission(UPDATE_PERMISSION)
  replace(
    @RequestContextData() ctx: RequestContext,
    @Param('destinationId', ParseUUIDPipe) destinationId: string,
    @Body() dto: ReplaceDestinationCreativeDto,
  ) {
    return this.destinationCreativeService.replaceForDestination(
      this.requireScope(ctx),
      destinationId,
      ctx.userId ?? null,
      dto,
    );
  }

  @Delete('destinations/:destinationId/creative')
  @RequirePermission(UPDATE_PERMISSION)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @RequestContextData() ctx: RequestContext,
    @Param('destinationId', ParseUUIDPipe) destinationId: string,
  ): Promise<void> {
    await this.destinationCreativeService.removeForDestination(
      this.requireScope(ctx),
      destinationId,
    );
  }

  /**
   * Scope comes only from server-resolved request context.
   * The request body cannot select tenant/workspace/client ownership.
   */
  private requireScope(ctx: RequestContext): DestinationCreativeScope {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    const managedContext = ctx.managedContext;
    const agencyClientId =
      managedContext?.operatingMode === 'client'
        ? (managedContext.clientId ?? null)
        : null;

    if (managedContext?.operatingMode === 'client' && !agencyClientId) {
      throw new BadRequestException('Client context is required.');
    }

    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      agencyClientId,
    };
  }
}
