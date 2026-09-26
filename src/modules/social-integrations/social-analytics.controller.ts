import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import {
  notFound,
  streamMetaThumbnail,
} from '../../common/meta/meta-thumbnail-proxy';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { AnalyticsAdSetsQueryDto } from './dto/analytics-ad-sets.query.dto';
import { AnalyticsAdThumbnailQueryDto } from './dto/analytics-ad-thumbnail.query.dto';
import { AnalyticsAdsQueryDto } from './dto/analytics-ads.query.dto';
import { AnalyticsBreakdownQueryDto } from './dto/analytics-breakdown.query.dto';
import { AnalyticsCampaignsQueryDto } from './dto/analytics-campaigns.query.dto';
import { AnalyticsFreshnessQueryDto } from './dto/analytics-freshness.query.dto';
import { AnalyticsOverviewQueryDto } from './dto/analytics-overview.query.dto';
import { SocialAdBreakdownReadService } from './services/social-ad-breakdown.read.service';
import { SocialAdCreativeThumbnailService } from './services/social-ad-creative-thumbnail.service';
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
    private readonly breakdownReadService: SocialAdBreakdownReadService,
    private readonly creativeThumbnailService: SocialAdCreativeThumbnailService,
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
      ...scope,
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
      ...scope,
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
      ...scope,
      connectionId: query.connectionId,
      since: query.since,
      until: query.until,
      sort: query.sort,
      direction: query.direction,
    });
  }

  /**
   * Per-ad-set totals for the period, ranked.
   *
   * Same shape and guarantees as `campaigns()`: `sort` is validated against a
   * closed list by the DTO and mapped through a closed lookup in the service,
   * and only ad sets with delivery inside the period appear. Each row carries
   * its parent campaign's external id, so a caller can group without a second
   * request.
   */
  @Get('ad-sets')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  adSets(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AnalyticsAdSetsQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.analyticsReadService.adSets({
      ...scope,
      connectionId: query.connectionId,
      since: query.since,
      until: query.until,
      sort: query.sort,
      direction: query.direction,
    });
  }

  /**
   * Per-ad totals for the period, ranked.
   *
   * The finest grain the facts table holds, and the only one at which "which
   * creative worked" can be answered: one ad set routinely runs several ads
   * against one audience on one budget, so dividing its spend between them
   * would be an estimate rather than a measurement.
   *
   * Each row carries `creativeId` — the id, never a URL — which is what the
   * thumbnail route below turns into a picture. Only ads with delivery inside
   * the period appear.
   */
  @Get('ads')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  ads(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AnalyticsAdsQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.analyticsReadService.ads({
      ...scope,
      connectionId: query.connectionId,
      since: query.since,
      until: query.until,
      sort: query.sort,
      direction: query.direction,
    });
  }

  /**
   * One ad's creative thumbnail, resolved from Meta at this moment.
   *
   * The bytes are relayed through this process rather than redirected to. That
   * was not the first design and the reason is worth keeping: a `302` to the
   * signed CDN URL kept the access token here, which was right, but the client
   * must call `fetch` (its credentials are headers, which an `<img>` would not
   * send), so the redirect was followed as a CORS request and Meta's CDN serves
   * no `Access-Control-Allow-Origin`. The browser blocked every response and
   * every thumbnail drew a placeholder, with nothing failing anywhere.
   * `streamMetaThumbnail` documents the whole chain.
   *
   * Nothing about the picture is stored either way — Meta signs these URLs with
   * an expiry of roughly five days, so a persisted one renders for a few days
   * and then 403s.
   *
   * 404 for every ordinary absence: an ad this scope cannot see, an ad the
   * hierarchy sync has not learned a creative for, a provider that will not
   * answer. The client draws a placeholder, because the row is about the
   * numbers beside it.
   */
  @Get('ads/thumbnail')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  async adThumbnail(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AnalyticsAdThumbnailQueryDto,
    @Res() response: Response,
  ) {
    const scope = this.requireScope(ctx);

    const url = await this.creativeThumbnailService.resolve({
      ...scope,
      connectionId: query.connectionId,
      adExternalId: query.adId,
    });

    if (!url) {
      notFound(response);
      return;
    }

    await streamMetaThumbnail(url, response);
  }

  /**
   * One dimension's distribution over the period: age/gender, device, platform.
   *
   * Same permission as every other read here — it is the same act on the same
   * facts, split a different way, and a separate key would mean a manager could
   * see an account's spend but not which age group it reached.
   *
   * The response carries `hasData` and `coveredDays` because an empty
   * distribution has two causes that a caller must be able to tell apart:
   * nothing was delivered, or breakdown ingestion has not run for this window.
   * The second is the *expected* state — the ingest is gated off by default —
   * so a UI that read emptiness as "no audience" would be wrong on most
   * deployments.
   */
  @Get('breakdown')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ANALYTICS_READ_PERMISSION)
  breakdown(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AnalyticsBreakdownQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.breakdownReadService.breakdown({
      ...scope,
      connectionId: query.connectionId,
      kind: query.kind,
      since: query.since,
      until: query.until,
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
      ...scope,
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
    return resolveCompanyAwareScope(ctx);
  }
}
