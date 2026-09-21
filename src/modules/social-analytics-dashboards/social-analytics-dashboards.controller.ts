import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
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
  CreateSocialAnalyticsDashboardDto,
  UpdateSocialAnalyticsDashboardDto,
} from './dto/social-analytics-dashboard.dto';
import { SocialAnalyticsDashboardsService } from './social-analytics-dashboards.service';

/**
 * Reading a dashboard is reading a report, so it reuses the permission that
 * already governs that. Changing one is not: a dashboard is shared state for
 * the whole scope, and a manager who may read numbers should not silently
 * reshape what every colleague sees.
 */
const READ_PERMISSION = 'social.analytics.reports.view.operational';
const MANAGE_PERMISSION =
  'social.analytics.dashboards.manage.admin_or_explicit';

/**
 * CRUD for saved Analytics dashboards.
 *
 * A module of its own rather than a controller inside `social-integrations`.
 * That module owns provider credentials and the Meta read model; this one owns
 * a layout document and touches no provider at all. Putting it there would make
 * the analytics module depend on dashboard persistence to build, which is the
 * kind of cycle recorded in `project_social_e5_destination_creatives`.
 *
 * The route prefix stays under `social/analytics` because that is the surface
 * the frontend already talks to — the module boundary is a backend concern and
 * should not leak into the URL.
 */
@Controller('social/analytics/dashboards')
export class SocialAnalyticsDashboardsController {
  constructor(private readonly service: SocialAnalyticsDashboardsService) {}

  /**
   * The dashboards of the caller's context, built-in one first.
   *
   * Scope comes from the resolved managed context, never from the query: a
   * client id accepted from the caller would let any authenticated member list
   * another client's dashboards.
   */
  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(READ_PERMISSION)
  async list(@RequestContextData() ctx: RequestContext) {
    const items = await this.service.list(
      resolveCompanyAwareScope(ctx),
      ctx.userId ?? null,
    );

    return { items, total: items.length };
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(MANAGE_PERMISSION)
  create(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateSocialAnalyticsDashboardDto,
  ) {
    return this.service.create(
      resolveCompanyAwareScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  /**
   * Partial update — name, channels or layout, each independently optional.
   *
   * This is also the endpoint the layout autosave calls after a resize, which
   * is why the service assigns field by field: the autosave sends `layout`
   * alone, and a spread of the DTO would blank the name with it.
   */
  @Patch(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(MANAGE_PERMISSION)
  update(
    @RequestContextData() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateSocialAnalyticsDashboardDto,
  ) {
    return this.service.update(resolveCompanyAwareScope(ctx), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(MANAGE_PERMISSION)
  async remove(
    @RequestContextData() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.service.remove(resolveCompanyAwareScope(ctx), id);
  }
}
