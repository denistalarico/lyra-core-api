import {
  BadRequestException,
  Controller,
  Get,
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
import { AnalyticsCampaignsQueryDto } from './dto/analytics-campaigns.query.dto';
import { AnalyticsFreshnessQueryDto } from './dto/analytics-freshness.query.dto';
import { AnalyticsOverviewQueryDto } from './dto/analytics-overview.query.dto';
import { SocialAnalyticsReadService } from './services/social-analytics-read.service';

/**
 * Permission for reading Social Analytics.
 *
 * `view.operational` (manager and above), not the `settings.integrations.manage`
 * key the integrations controller uses. Those two guard genuinely different
 * acts: managing an integration administers a credential, while this returns
 * aggregated numbers about ads that were already run. Requiring admin to read a
 * report would either lock managers out of their own client's performance or
 * push somebody to hand out admin, which is the worse outcome of the two.
 *
 * `view.full` and `export.admin` exist in the same catalog group and are not
 * used here: this endpoint is neither the full report nor an export.
 */
const SOCIAL_ANALYTICS_READ_PERMISSION =
  'social.analytics.reports.view.operational';

/**
 * Read-only reporting over the local Meta Ads read model.
 *
 * A separate controller from `SocialIntegrationsController` on purpose. That one
 * administers connections and runs under an admin permission; this one reads
 * facts under an operational permission, and merging them would mean one class
 * whose handlers do not share a guard, a permission or an audience — the shape
 * that eventually gets a read endpoint decorated with the wrong key.
 *
 * No handler here reaches a provider. Every number comes from
 * `social_ad_metrics_daily`; the sync pipeline is what fills it.
 */
@Controller('social/analytics')
export class SocialAnalyticsController {
  constructor(
    private readonly analyticsReadService: SocialAnalyticsReadService,
  ) {}

  /**
   * The ad accounts this caller may report on.
   *
   * The dashboard needs a `connectionId` before it can ask anything else, and
   * the settings screen's connection list is admin-guarded — so a manager with
   * only the operational read permission had no way to obtain one. This closes
   * that gap without touching the settings guard: the payload is a strict subset
   * (no credential state, no token expiry, no scopes, no raw account id), under
   * the permission that already governs reading these numbers.
   *
   * Takes no query parameters at all. The scope is the authenticated context,
   * and there is nothing else to ask.
   */
  @Get('connections')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  async connections(@RequestContextData() ctx: RequestContext) {
    const scope = this.requireScope(ctx);

    const items = await this.analyticsReadService.listConnections(scope);

    return { items, total: items.length };
  }

  /**
   * Totals, derived KPIs and period-over-period movement for one connection.
   *
   * The connection id is a query parameter and the scope is not: tenant,
   * workspace and managed client come from the authenticated context and are
   * then used as part of the connection lookup, so a connection belonging to
   * another client is simply not found. Nothing in the query can widen what the
   * caller sees.
   */
  @Get('overview')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  overview(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AnalyticsOverviewQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.analyticsReadService.overview({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      connectionId: query.connectionId,
      since: query.since,
      until: query.until,
    });
  }

  /**
   * One point per calendar day of the period, ascending.
   *
   * Continuous: a day with no stored fact is present with `hasData: false` and
   * null metrics rather than absent or zeroed. A chart cannot otherwise tell a
   * day of no delivery from a day never synced, and would draw the same line
   * through both.
   */
  @Get('timeseries')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  timeseries(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AnalyticsOverviewQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.analyticsReadService.timeseries({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      connectionId: query.connectionId,
      since: query.since,
      until: query.until,
    });
  }

  /**
   * Per-campaign totals for the period, ranked.
   *
   * `sort` is validated against a closed list by the DTO and then mapped through
   * a closed lookup in the service; nothing the caller sends reaches the ORDER
   * BY as text. Defaults to `spend desc`, which is the ranking anybody opening
   * this page is asking for. Sorting by `name` orders by campaign identity, so
   * it stays stable for campaigns the hierarchy has not mirrored yet.
   *
   * Only campaigns with delivery inside the period appear.
   */
  @Get('campaigns')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  campaigns(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AnalyticsCampaignsQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.analyticsReadService.campaigns({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      connectionId: query.connectionId,
      since: query.since,
      until: query.until,
      sort: query.sort,
      direction: query.direction,
    });
  }

  /**
   * How current the read model is, and where the backfill chain stands.
   *
   * The answer to "why is yesterday missing?" without opening the settings
   * screen. Derived from the run log using the planner's own chunk logic, and
   * enqueues nothing — loading a dashboard must not queue provider work.
   */
  @Get('freshness')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  freshness(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AnalyticsFreshnessQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.analyticsReadService.freshness({
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId: scope.agencyClientId,
      connectionId: query.connectionId,
    });
  }

  /**
   * The client binding comes from the server-resolved managed context, never
   * from the request. A client id supplied by the caller would let an
   * authenticated agency member read any client's ad performance.
   *
   * `PermissionsGuard` has already verified that this user may read the `social`
   * product for this client before the handler runs.
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
