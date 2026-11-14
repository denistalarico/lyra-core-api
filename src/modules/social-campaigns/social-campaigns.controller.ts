import { ClientAreaExposed } from '../client-area/client-area.decorators';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  DangerousAction,
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  CreateSocialBoostTemplateDto,
  GenerateSocialCampaignRecommendationDto,
  ConfirmSocialAdActionDto,
  MetaCampaignHierarchyQueryDto,
  SocialCampaignMonitorQueryDto,
  SocialCampaignRecommendationListQueryDto,
  SocialAdActionHistoryQueryDto,
  SocialAdActionPolicyQueryDto,
  SocialAdActionPreflightDto,
  UpdateSocialAdActionPolicyDto,
  UpdateSocialCampaignMonitorPolicyDto,
  UpdateSocialBoostTemplateDto,
  SocialBoostPreflightDto,
  ConfirmSocialBoostDto,
  SocialBoostTargetingQueryDto,
  ScheduleSocialBoostDto,
  UpdateScheduledSocialBoostDto,
} from './dto';
import { MetaCampaignHierarchyReadService } from './services/meta-campaign-hierarchy-read.service';
import { SocialCampaignMonitorService } from './services/social-campaign-monitor.service';
import { SocialCampaignRecommendationService } from './services/social-campaign-recommendation.service';
import { SocialBoostTemplateService } from './services/social-boost-template.service';
import { SocialAdManualActionService } from './services/social-ad-manual-action.service';
import { SocialBoostRequestService } from './services/social-boost-request.service';
import { MetaAdsBoostTargetingService } from './services/meta-ads-boost-targeting.service';
import { SocialScheduledBoostService } from './services/social-scheduled-boost.service';
import { mapSocialAdSyncError } from '../social-integrations/sync/social-ad-sync.http-error';

const SOCIAL_ADS_VIEW_PERMISSION = 'social.ads.campaign.view.client';
const SOCIAL_ADS_MANAGE_PERMISSION =
  'social.ads.campaign.manage.admin_or_explicit';
const ACTION_POLICY_PERMISSION =
  'social.ads.actions.policy.manage.admin_or_explicit';
const STATUS_ACTION_PERMISSION = 'social.ads.status.execute.admin_or_explicit';
const BUDGET_ACTION_PERMISSION = 'social.ads.budget.execute.admin_or_explicit';
const SCHEDULE_ACTION_PERMISSION =
  'social.ads.schedule.execute.admin_or_explicit';
const DELETE_ACTION_PERMISSION = 'social.ads.delete.execute.owner_only';
const BOOST_ACTION_PERMISSION = 'social.ads.boost.execute.admin_or_explicit';

@Controller('social/campaigns')
export class SocialCampaignsController {
  constructor(
    private readonly templates: SocialBoostTemplateService,
    private readonly hierarchy: MetaCampaignHierarchyReadService,
    private readonly monitor: SocialCampaignMonitorService,
    private readonly recommendations: SocialCampaignRecommendationService,
    private readonly manualActions: SocialAdManualActionService,
    private readonly boostRequests: SocialBoostRequestService,
    private readonly boostTargeting: MetaAdsBoostTargetingService,
    private readonly scheduledBoosts: SocialScheduledBoostService,
  ) {}

  @Post('meta/boost/preflight')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(BOOST_ACTION_PERMISSION)
  preflightBoost(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SocialBoostPreflightDto,
  ) {
    return this.boostRequests.preflight(
      this.requireScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  @Get('meta/boost/targeting')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_MANAGE_PERMISSION)
  async searchBoostTargeting(
    @RequestContextData() ctx: RequestContext,
    @Query() query: SocialBoostTargetingQueryDto,
  ) {
    try {
      return await this.boostTargeting.search(this.requireScope(ctx), query);
    } catch (error) {
      // The Meta client and credential resolver already classify failures into
      // safe codes. Reuse that boundary rather than returning provider text or
      // reducing every distinct repair to a generic 500 in the browser.
      throw mapSocialAdSyncError(error);
    }
  }

  /**
   * Planner boost at scheduling time. Every route here is internal (no
   * `ClientAreaExposed`): authorizing spend stays with the agency.
   */
  @Get('meta/boost/scheduled')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_VIEW_PERMISSION)
  listBoosts(@RequestContextData() ctx: RequestContext) {
    return this.scheduledBoosts.list(this.requireScope(ctx));
  }

  @Get('meta/boost/scheduled/check')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(BOOST_ACTION_PERMISSION)
  checkScheduledBoost(
    @RequestContextData() ctx: RequestContext,
    @Query('templateId', ParseUUIDPipe) templateId: string,
    @Query('connectionId', ParseUUIDPipe) connectionId: string,
  ) {
    return this.scheduledBoosts.check(this.requireScope(ctx), {
      templateId,
      connectionId,
    });
  }

  @Post('meta/boost/scheduled')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(BOOST_ACTION_PERMISSION)
  @DangerousAction()
  scheduleBoost(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: ScheduleSocialBoostDto,
  ) {
    return this.scheduledBoosts.schedule(
      this.requireScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  @Patch('meta/boost/scheduled/:scheduledBoostId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(BOOST_ACTION_PERMISSION)
  @DangerousAction()
  updateScheduledBoost(
    @RequestContextData() ctx: RequestContext,
    @Param('scheduledBoostId', ParseUUIDPipe) scheduledBoostId: string,
    @Body() dto: UpdateScheduledSocialBoostDto,
  ) {
    return this.scheduledBoosts.updateTemplate(
      this.requireScope(ctx),
      scheduledBoostId,
      dto,
    );
  }

  @Post('meta/boost/scheduled/:scheduledBoostId/cancel')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(BOOST_ACTION_PERMISSION)
  cancelScheduledBoost(
    @RequestContextData() ctx: RequestContext,
    @Param('scheduledBoostId', ParseUUIDPipe) scheduledBoostId: string,
  ) {
    return this.scheduledBoosts.cancel(
      this.requireScope(ctx),
      ctx.userId ?? null,
      scheduledBoostId,
    );
  }

  @Post('meta/boost/:boostRequestId/confirm')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(BOOST_ACTION_PERMISSION)
  @DangerousAction()
  confirmBoost(
    @RequestContextData() ctx: RequestContext,
    @Param('boostRequestId', ParseUUIDPipe) boostRequestId: string,
    @Body() dto: ConfirmSocialBoostDto,
  ) {
    return this.boostRequests.confirm(
      this.requireScope(ctx),
      ctx.userId ?? null,
      boostRequestId,
      dto.confirmationRequestId,
    );
  }

  @ClientAreaExposed('social_campaigns')
  @Get('meta/actions/availability')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_VIEW_PERMISSION)
  actionAvailability() {
    return this.manualActions.availability();
  }

  @ClientAreaExposed('social_campaigns')
  @Get('meta/actions/policy')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_VIEW_PERMISSION)
  actionPolicy(
    @RequestContextData() ctx: RequestContext,
    @Query() query: SocialAdActionPolicyQueryDto,
  ) {
    return this.manualActions.getPolicy(
      this.requireScope(ctx),
      query.connectionId,
    );
  }

  @Patch('meta/actions/policy')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(ACTION_POLICY_PERMISSION)
  updateActionPolicy(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpdateSocialAdActionPolicyDto,
  ) {
    return this.manualActions.updatePolicy(
      this.requireScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  @ClientAreaExposed('social_campaigns')
  @Get('meta/actions/history')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_VIEW_PERMISSION)
  actionHistory(
    @RequestContextData() ctx: RequestContext,
    @Query() query: SocialAdActionHistoryQueryDto,
  ) {
    return this.manualActions.history(
      this.requireScope(ctx),
      query.connectionId,
      query.limit,
    );
  }

  @ClientAreaExposed('social_campaigns')
  @Post('meta/actions/status/preflight')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(STATUS_ACTION_PERMISSION)
  preflightStatus(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SocialAdActionPreflightDto,
  ) {
    return this.manualActions.preflight(
      this.requireScope(ctx),
      ctx.userId ?? null,
      'set_status',
      dto,
    );
  }

  @ClientAreaExposed('social_campaigns')
  @Post('meta/actions/status/:actionId/confirm')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(STATUS_ACTION_PERMISSION)
  confirmStatus(
    @RequestContextData() ctx: RequestContext,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: ConfirmSocialAdActionDto,
  ) {
    return this.manualActions.confirm(
      this.requireScope(ctx),
      ctx.userId ?? null,
      'set_status',
      actionId,
      dto.confirmationRequestId,
      dto.confirmationText,
    );
  }

  @ClientAreaExposed('social_campaigns')
  @Post('meta/actions/budget/preflight')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(BUDGET_ACTION_PERMISSION)
  preflightBudget(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SocialAdActionPreflightDto,
  ) {
    return this.manualActions.preflight(
      this.requireScope(ctx),
      ctx.userId ?? null,
      'set_budget',
      dto,
    );
  }

  @ClientAreaExposed('social_campaigns')
  @Post('meta/actions/budget/:actionId/confirm')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(BUDGET_ACTION_PERMISSION)
  confirmBudget(
    @RequestContextData() ctx: RequestContext,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: ConfirmSocialAdActionDto,
  ) {
    return this.manualActions.confirm(
      this.requireScope(ctx),
      ctx.userId ?? null,
      'set_budget',
      actionId,
      dto.confirmationRequestId,
      dto.confirmationText,
    );
  }

  @ClientAreaExposed('social_campaigns')
  @Post('meta/actions/schedule/preflight')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SCHEDULE_ACTION_PERMISSION)
  preflightSchedule(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SocialAdActionPreflightDto,
  ) {
    return this.manualActions.preflight(
      this.requireScope(ctx),
      ctx.userId ?? null,
      'set_end_time',
      dto,
    );
  }

  @ClientAreaExposed('social_campaigns')
  @Post('meta/actions/schedule/:actionId/confirm')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SCHEDULE_ACTION_PERMISSION)
  confirmSchedule(
    @RequestContextData() ctx: RequestContext,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: ConfirmSocialAdActionDto,
  ) {
    return this.manualActions.confirm(
      this.requireScope(ctx),
      ctx.userId ?? null,
      'set_end_time',
      actionId,
      dto.confirmationRequestId,
      dto.confirmationText,
    );
  }

  @Post('meta/actions/delete/preflight')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(DELETE_ACTION_PERMISSION)
  preflightDelete(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SocialAdActionPreflightDto,
  ) {
    return this.manualActions.preflight(
      this.requireScope(ctx),
      ctx.userId ?? null,
      'delete',
      dto,
    );
  }

  @Post('meta/actions/delete/:actionId/confirm')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(DELETE_ACTION_PERMISSION)
  @DangerousAction()
  confirmDelete(
    @RequestContextData() ctx: RequestContext,
    @Param('actionId', ParseUUIDPipe) actionId: string,
    @Body() dto: ConfirmSocialAdActionDto,
  ) {
    return this.manualActions.confirm(
      this.requireScope(ctx),
      ctx.userId ?? null,
      'delete',
      actionId,
      dto.confirmationRequestId,
      dto.confirmationText,
    );
  }

  @ClientAreaExposed('social_campaigns')
  @Get('meta/recommendations/availability')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_VIEW_PERMISSION)
  recommendationAvailability() {
    return this.recommendations.availability();
  }

  @ClientAreaExposed('social_campaigns')
  @Get('meta/recommendations')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_VIEW_PERMISSION)
  listRecommendations(
    @RequestContextData() ctx: RequestContext,
    @Query() query: SocialCampaignRecommendationListQueryDto,
  ) {
    return this.recommendations.list(
      this.requireScope(ctx),
      query.connectionId,
      query.limit,
    );
  }

  @ClientAreaExposed('social_campaigns')
  @Post('meta/recommendations/generate')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_MANAGE_PERMISSION)
  generateRecommendations(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: GenerateSocialCampaignRecommendationDto,
  ) {
    return this.recommendations.generate(
      this.requireScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  @ClientAreaExposed('social_campaigns')
  @Get('meta/monitor')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_VIEW_PERMISSION)
  monitorOverview(
    @RequestContextData() ctx: RequestContext,
    @Query() query: SocialCampaignMonitorQueryDto,
  ) {
    return this.monitor.overview(this.requireScope(ctx), query.connectionId);
  }

  @Patch('meta/monitor/policy')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_MANAGE_PERMISSION)
  updateMonitorPolicy(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpdateSocialCampaignMonitorPolicyDto,
  ) {
    return this.monitor.updatePolicy(
      this.requireScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  /** Evaluates the local mirror now. It never calls or mutates Meta. */
  @ClientAreaExposed('social_campaigns')
  @Post('meta/monitor/evaluate')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_MANAGE_PERMISSION)
  evaluateMonitor(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SocialCampaignMonitorQueryDto,
  ) {
    return this.monitor.evaluate(this.requireScope(ctx), dto.connectionId);
  }

  @ClientAreaExposed('social_campaigns')
  @Patch('meta/alerts/:alertId/acknowledge')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_MANAGE_PERMISSION)
  acknowledgeAlert(
    @RequestContextData() ctx: RequestContext,
    @Param('alertId', ParseUUIDPipe) alertId: string,
  ) {
    return this.monitor.acknowledge(
      this.requireScope(ctx),
      alertId,
      ctx.userId ?? null,
    );
  }

  @ClientAreaExposed('social_campaigns')
  @Get('meta/hierarchy')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_VIEW_PERMISSION)
  metaHierarchy(
    @RequestContextData() ctx: RequestContext,
    @Query() query: MetaCampaignHierarchyQueryDto,
  ) {
    return this.hierarchy.read({
      ...this.requireScope(ctx),
      connectionId: query.connectionId,
      since: query.since,
      until: query.until,
      status: query.status,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
  }

  /** G2: same view over the local Google Ads mirror. Read-only (D-G7). */
  @ClientAreaExposed('social_campaigns')
  @Get('google/hierarchy')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_VIEW_PERMISSION)
  googleHierarchy(
    @RequestContextData() ctx: RequestContext,
    @Query() query: MetaCampaignHierarchyQueryDto,
  ) {
    return this.hierarchy.read({
      ...this.requireScope(ctx),
      connectionId: query.connectionId,
      since: query.since,
      until: query.until,
      status: query.status,
      search: query.search,
      page: query.page,
      limit: query.limit,
      provider: 'google_ads',
    });
  }

  @ClientAreaExposed('social_campaigns')
  @Get('boost-templates')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_VIEW_PERMISSION)
  list(
    @RequestContextData() ctx: RequestContext,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.templates.list(
      this.requireScope(ctx),
      includeInactive === 'true',
    );
  }

  @Post('boost-templates')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_MANAGE_PERMISSION)
  create(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateSocialBoostTemplateDto,
  ) {
    return this.templates.create(
      this.requireScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  @Patch('boost-templates/:templateId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(SOCIAL_ADS_MANAGE_PERMISSION)
  update(
    @RequestContextData() ctx: RequestContext,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() dto: UpdateSocialBoostTemplateDto,
  ) {
    return this.templates.update(
      this.requireScope(ctx),
      templateId,
      ctx.userId ?? null,
      dto,
    );
  }

  /** Scope is server-resolved; no DTO accepts tenant, workspace or client. */
  private requireScope(ctx: RequestContext) {
    return resolveCompanyAwareScope(ctx);
  }
}
