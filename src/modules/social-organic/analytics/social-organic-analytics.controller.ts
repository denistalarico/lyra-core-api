import {
  Controller,
  Get,
  HttpStatus,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { resolveCompanyAwareScope } from '../../../common/context/company-aware-scope';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../../permissions';
import { AnalyticsAudienceQueryDto } from './dto/analytics-audience.query.dto';
import { AnalyticsThumbnailQueryDto } from './dto/analytics-thumbnail.query.dto';
import { AnalyticsTopPostsQueryDto } from './dto/analytics-top-posts.query.dto';
import { AnalyticsFreshnessQueryDto } from './dto/analytics-freshness.query.dto';
import { AnalyticsOverviewQueryDto } from './dto/analytics-overview.query.dto';
import { ConsolidatedOverviewQueryDto } from './dto/consolidated-overview.query.dto';
import { PublicationMetricsQueryDto } from './dto/publication-metrics.query.dto';
import { SocialConsolidatedAnalyticsService } from './social-consolidated-analytics.service';
import { SocialOrganicAnalyticsReadService } from './social-organic-analytics-read.service';
import { SocialOrganicAudienceReadService } from './social-organic-audience-read.service';
import { SocialOrganicThumbnailService } from './social-organic-thumbnail.service';

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
    private readonly audienceReadService: SocialOrganicAudienceReadService,
    private readonly thumbnailService: SocialOrganicThumbnailService,
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

  /**
   * Redirects to one post's current image, resolved from the provider now.
   *
   * A redirect rather than proxied bytes: the browser then fetches the picture
   * straight from Meta's CDN, so this process never streams image data and the
   * access token never leaves it either. The URL is deliberately not stored
   * anywhere — Meta signs it with a ~5 day expiry, and a persisted one turns
   * into a broken image days later.
   *
   * 404 when there is nothing to show, which the front end renders as a
   * placeholder. A missing thumbnail must never fail a page whose subject is
   * the metrics beside it.
   */
  @Get('posts/thumbnail')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ORGANIC_ANALYTICS_PERMISSION)
  async postThumbnail(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AnalyticsThumbnailQueryDto,
    @Res() response: Response,
  ) {
    const scope = this.requireScope(ctx);

    const url = await this.thumbnailService.resolve({
      ...scope,
      assetId: query.assetId,
      externalPublicationId: query.postId,
    });

    if (!url) {
      response.status(HttpStatus.NOT_FOUND).json({ message: 'Not found.' });
      return;
    }

    // Private: the redirect target is scoped to this viewer's credential, so a
    // shared cache must not hand it to another tenant. Short, because the
    // signed URL behind it expires on its own schedule.
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.redirect(HttpStatus.FOUND, url);
  }

  /**
   * The asset's best posts in one period, ranked by a lifetime counter.
   *
   * The window filters on when each post was **published**, not on when Lyra
   * observed it: the question is which content performed, and the observation
   * day is an implementation detail of the sync. Each post appears once, from
   * its newest observation — see `topPosts` for why that matters.
   */
  @Get('posts/top')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ORGANIC_ANALYTICS_PERMISSION)
  topPosts(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AnalyticsTopPostsQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.analyticsReadService.topPosts({
      ...scope,
      assetId: query.assetId,
      since: query.since,
      until: query.until,
      sort: query.sort,
      surface: query.surface,
      limit: query.limit,
    });
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
      ...scope,
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
      ...scope,
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
      ...scope,
      assetId: query.assetId,
    });
  }

  /**
   * Follower demographics for one asset and one dimension, as of the newest
   * snapshot.
   *
   * Takes no period, and that is the contract rather than an omission: these are
   * lifetime stocks, so a window aggregate would count the same followers once
   * per day in it. `asOf` says which day the answer comes from, and `hasData`
   * separates "not ingested" — the default, since ingestion is gated off — from
   * "no followers".
   *
   * Same permission as every other read here: it is the same act on the same
   * asset, split a different way.
   */
  @Get('audience')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ORGANIC_ANALYTICS_PERMISSION)
  audience(
    @RequestContextData() ctx: RequestContext,
    @Query() query: AnalyticsAudienceQueryDto,
  ) {
    const scope = this.requireScope(ctx);

    return this.audienceReadService.audience({
      ...scope,
      assetId: query.assetId,
      kind: query.kind,
    });
  }

  /**
   * Latest local organic metrics for one or more Lyra publications. This is a
   * read over the persisted model only: it does not call Meta or trigger a
   * sync, so historical data remains readable after a credential disconnect.
   */
  @Get('publications')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ORGANIC_ANALYTICS_PERMISSION)
  async publicationMetrics(
    @RequestContextData() ctx: RequestContext,
    @Query() query: PublicationMetricsQueryDto,
  ) {
    const scope = this.requireScope(ctx);
    const items = await this.analyticsReadService.publicationMetrics({
      ...scope,
      publicationIds: query.publicationIds,
    });

    return { items, total: items.length };
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
      ...scope,
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
    return resolveCompanyAwareScope(ctx);
  }
}
