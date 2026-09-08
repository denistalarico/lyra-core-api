import {
  BadRequestException,
  Controller,
  Get,
  Query,
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
import { AnalyticsFreshnessQueryDto } from './dto/analytics-freshness.query.dto';
import { AnalyticsOverviewQueryDto } from './dto/analytics-overview.query.dto';
import { ConsolidatedOverviewQueryDto } from './dto/consolidated-overview.query.dto';
import { SocialConsolidatedAnalyticsService } from './social-consolidated-analytics.service';
import { SocialOrganicAnalyticsReadService } from './social-organic-analytics-read.service';

/**
 * Reused verbatim from A2's on-demand sync endpoint
 * (`SocialOrganicController`) — no catalog change for A3/A4. MANAGER_UP
 * tier, distinct from `social.settings.integrations.manage.admin`: reading
 * aggregated organic numbers is a different act than administering a
 * credential, and requiring admin to read a report would either lock
 * managers out of their own client's performance or push somebody to hand
 * out admin.
 */
const SOCIAL_ORGANIC_ANALYTICS_PERMISSION =
  'social.analytics.organic.view.operational';

/**
 * Read-only reporting over the local organic read model (A3), plus the
 * consolidated paid+organic view (A4).
 *
 * A new, dedicated controller — not added to `SocialOrganicController` —
 * mirroring the paid module's `SocialAnalyticsController` /
 * `SocialIntegrationsController` split: admin-gated connection management
 * lives on one controller, operational-tier reads on another. No route
 * collision: paid lives at `social/analytics/*`; A2's sync-trigger stays on
 * `SocialOrganicController` at `social/organic/assets/:assetId/analytics/sync`.
 *
 * A4's `consolidated` route lives here rather than on a third controller: it
 * has no independent read model of its own — it is purely a merge of this
 * service and the paid module's `SocialAnalyticsReadService` — so the
 * admin-vs-operational split that justifies the controller boundary above
 * does not apply a second time.
 */
@Controller('social/organic/analytics')
export class SocialOrganicAnalyticsController {
  constructor(
    private readonly analyticsReadService: SocialOrganicAnalyticsReadService,
    private readonly consolidatedReadService: SocialConsolidatedAnalyticsService,
  ) {}

  @Get('assets')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ORGANIC_ANALYTICS_PERMISSION)
  async listAssets(@RequestContextData() ctx: RequestContext) {
    const scope = this.requireScope(ctx);

    const items = await this.analyticsReadService.listAssets(scope);

    return { items, total: items.length };
  }

  @Get('overview')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ORGANIC_ANALYTICS_PERMISSION)
  overview(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AnalyticsOverviewQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.analyticsReadService.overview({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      assetId: query.assetId,
      since: query.since,
      until: query.until,
    });
  }

  @Get('timeseries')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ORGANIC_ANALYTICS_PERMISSION)
  timeseries(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AnalyticsOverviewQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.analyticsReadService.timeseries({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      assetId: query.assetId,
      since: query.since,
      until: query.until,
    });
  }

  @Get('freshness')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ORGANIC_ANALYTICS_PERMISSION)
  freshness(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AnalyticsFreshnessQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.analyticsReadService.freshness({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      assetId: query.assetId,
    });
  }

  /**
   * A4: paid + organic side by side for the same period, never summed. Guard
   * is `SOCIAL_ORGANIC_ANALYTICS_PERMISSION` only — the confirmed decision:
   * no new "require both" permission primitive in this task.
   */
  @Get('consolidated')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ORGANIC_ANALYTICS_PERMISSION)
  consolidated(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ConsolidatedOverviewQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.consolidatedReadService.overview({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      paidConnectionId: query.paidConnectionId,
      organicAssetId: query.organicAssetId,
      since: query.since,
      until: query.until,
    });
  }

  /**
   * Scope only from `RequestContext`, never query/body — copied verbatim
   * from `SocialOrganicController.requireScope`.
   */
  private requireScope(ctx: RequestContext) {
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
