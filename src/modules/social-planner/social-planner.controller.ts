import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import {
  ConvertSocialContentIdeaDto,
  CreateSocialCampaignDto,
  CreateSocialCampaignTemplateDto,
  CreateSocialContentIdeaDto,
  CreateSocialContentItemDto,
  CreateSocialEditorialPillarDto,
  CreateSocialPlanDto,
  ListSocialContentIdeasQueryDto,
  UpdateSocialCampaignDto,
  UpdateSocialCampaignTemplateDto,
  UpdateSocialContentIdeaDto,
  UpdateSocialContentItemDto,
  UpdateSocialEditorialPillarDto,
  UpdateSocialPlanDto,
  UpsertSocialContentDestinationsDto,
  CreateSocialContentRevisionDto,
  UpdateSocialPlannerSettingsDto,
  UpdateSocialPublishingCadenceDto,
} from './dto';
import {
  SocialPlannerService,
  type SocialPlannerScope,
} from './services/social-planner.service';
import { SocialCampaignService } from './services/social-campaign.service';
import { SocialPlannerSettingsService } from './services/social-planner-settings.service';
import { SocialPublishingCadenceService } from './services/social-publishing-cadence.service';

const SOCIAL_PLANNER_VIEW_PERMISSION = 'social.planner.calendar.view.client';

const SOCIAL_PLANNER_CREATE_PERMISSION =
  'social.planner.calendar.create.manager';

const SOCIAL_PLANNER_UPDATE_PERMISSION =
  'social.planner.calendar.update.manager';

/**
 * Campaigns answer to `social.campaigns.*`, not to `social.planner.*`.
 *
 * Those keys already existed in the permission catalog before this etapa,
 * which is the clearest available statement that a campaign is a Social-wide
 * object the Planner happens to be the first consumer of. Creative Studio and
 * Ads will read the same rows under the same keys.
 */
const SOCIAL_CAMPAIGN_VIEW_PERMISSION = 'social.campaigns.campaign.view.client';

const SOCIAL_CAMPAIGN_CREATE_PERMISSION =
  'social.campaigns.campaign.create.manager';

const SOCIAL_CAMPAIGN_UPDATE_PERMISSION =
  'social.campaigns.campaign.update.manager';

@Controller('social/planner')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class SocialPlannerController {
  constructor(
    private readonly socialPlannerService: SocialPlannerService,
    private readonly socialPlannerSettingsService: SocialPlannerSettingsService,
    private readonly socialPublishingCadenceService: SocialPublishingCadenceService,
    private readonly socialCampaignService: SocialCampaignService,
  ) {}

  @Get('plans')
  @RequirePermission(SOCIAL_PLANNER_VIEW_PERMISSION)
  listPlans(@RequestContextData() ctx: RequestContext) {
    return this.socialPlannerService.listPlans(this.requireScope(ctx));
  }

  @Post('plans')
  @RequirePermission(SOCIAL_PLANNER_CREATE_PERMISSION)
  createPlan(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateSocialPlanDto,
  ) {
    return this.socialPlannerService.createPlan(
      this.requireScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  @Get('plans/:planId')
  @RequirePermission(SOCIAL_PLANNER_VIEW_PERMISSION)
  getPlan(
    @RequestContextData() ctx: RequestContext,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    return this.socialPlannerService.getPlan(this.requireScope(ctx), planId);
  }

  @Patch('plans/:planId')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  updatePlan(
    @RequestContextData() ctx: RequestContext,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: UpdateSocialPlanDto,
  ) {
    return this.socialPlannerService.updatePlan(
      this.requireScope(ctx),
      planId,
      ctx.userId ?? null,
      dto,
    );
  }

  @Post('plans/:planId/archive')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  archivePlan(
    @RequestContextData() ctx: RequestContext,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    return this.socialPlannerService.archivePlan(
      this.requireScope(ctx),
      planId,
      ctx.userId ?? null,
    );
  }

  @Get('plans/:planId/content')
  @RequirePermission(SOCIAL_PLANNER_VIEW_PERMISSION)
  listContent(
    @RequestContextData() ctx: RequestContext,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    return this.socialPlannerService.listContent(
      this.requireScope(ctx),
      planId,
    );
  }

  @Post('plans/:planId/content')
  @RequirePermission(SOCIAL_PLANNER_CREATE_PERMISSION)
  createContent(
    @RequestContextData() ctx: RequestContext,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: CreateSocialContentItemDto,
  ) {
    return this.socialPlannerService.createContent(
      this.requireScope(ctx),
      planId,
      ctx.userId ?? null,
      dto,
    );
  }

  @Get('content/:contentId')
  @RequirePermission(SOCIAL_PLANNER_VIEW_PERMISSION)
  getContent(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    return this.socialPlannerService.getContent(
      this.requireScope(ctx),
      contentId,
    );
  }

  @Patch('content/:contentId')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  updateContent(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() dto: UpdateSocialContentItemDto,
  ) {
    return this.socialPlannerService.updateContent(
      this.requireScope(ctx),
      contentId,
      ctx.userId ?? null,
      dto,
    );
  }

  @Put('content/:contentId/destinations')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  replaceDestinations(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() dto: UpsertSocialContentDestinationsDto,
  ) {
    return this.socialPlannerService.replaceDestinations(
      this.requireScope(ctx),
      contentId,
      dto,
    );
  }

  @Get('content/:contentId/revisions')
  @RequirePermission(SOCIAL_PLANNER_VIEW_PERMISSION)
  listRevisions(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    return this.socialPlannerService.listRevisions(
      this.requireScope(ctx),
      contentId,
    );
  }

  @Post('content/:contentId/revisions')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  createRevision(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Body() dto: CreateSocialContentRevisionDto,
  ) {
    return this.socialPlannerService.createRevision(
      this.requireScope(ctx),
      contentId,
      ctx.userId ?? null,
      dto,
    );
  }

  @Post('content/:contentId/revisions/:revisionId/restore')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  restoreRevision(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
    @Param('revisionId', ParseUUIDPipe) revisionId: string,
  ) {
    return this.socialPlannerService.restoreRevision(
      this.requireScope(ctx),
      contentId,
      revisionId,
      ctx.userId ?? null,
    );
  }

  // -------------------------------------------------------------- campaigns

  @Get('campaign-templates')
  @RequirePermission(SOCIAL_CAMPAIGN_VIEW_PERMISSION)
  listCampaignTemplates(@RequestContextData() ctx: RequestContext) {
    return this.socialCampaignService.listCampaignTemplates(
      this.requireScope(ctx),
    );
  }

  @Post('campaign-templates')
  @RequirePermission(SOCIAL_CAMPAIGN_CREATE_PERMISSION)
  createCampaignTemplate(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateSocialCampaignTemplateDto,
  ) {
    return this.socialCampaignService.createCampaignTemplate(
      this.requireScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  @Patch('campaign-templates/:templateId')
  @RequirePermission(SOCIAL_CAMPAIGN_UPDATE_PERMISSION)
  updateCampaignTemplate(
    @RequestContextData() ctx: RequestContext,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Body() dto: UpdateSocialCampaignTemplateDto,
  ) {
    return this.socialCampaignService.updateCampaignTemplate(
      this.requireScope(ctx),
      templateId,
      ctx.userId ?? null,
      dto,
    );
  }

  @Get('campaigns')
  @RequirePermission(SOCIAL_CAMPAIGN_VIEW_PERMISSION)
  listCampaigns(@RequestContextData() ctx: RequestContext) {
    return this.socialCampaignService.listCampaigns(this.requireScope(ctx));
  }

  @Post('campaigns')
  @RequirePermission(SOCIAL_CAMPAIGN_CREATE_PERMISSION)
  createCampaign(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateSocialCampaignDto,
  ) {
    return this.socialCampaignService.createCampaign(
      this.requireScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  @Patch('campaigns/:campaignId')
  @RequirePermission(SOCIAL_CAMPAIGN_UPDATE_PERMISSION)
  updateCampaign(
    @RequestContextData() ctx: RequestContext,
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: UpdateSocialCampaignDto,
  ) {
    return this.socialCampaignService.updateCampaign(
      this.requireScope(ctx),
      campaignId,
      ctx.userId ?? null,
      dto,
    );
  }

  // ---------------------------------------------------------------- pillars

  @Get('pillars')
  @RequirePermission(SOCIAL_PLANNER_VIEW_PERMISSION)
  listPillars(@RequestContextData() ctx: RequestContext) {
    return this.socialCampaignService.listPillars(this.requireScope(ctx));
  }

  @Post('pillars')
  @RequirePermission(SOCIAL_PLANNER_CREATE_PERMISSION)
  createPillar(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateSocialEditorialPillarDto,
  ) {
    return this.socialCampaignService.createPillar(
      this.requireScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  @Patch('pillars/:pillarId')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  updatePillar(
    @RequestContextData() ctx: RequestContext,
    @Param('pillarId', ParseUUIDPipe) pillarId: string,
    @Body() dto: UpdateSocialEditorialPillarDto,
  ) {
    return this.socialCampaignService.updatePillar(
      this.requireScope(ctx),
      pillarId,
      ctx.userId ?? null,
      dto,
    );
  }

  /**
   * Declared before `plans/:planId` would otherwise be reachable is not a
   * concern here: this path is `plans/:planId/pillar-coverage`, which is
   * strictly longer and cannot be shadowed by the single-segment route.
   */
  @Get('plans/:planId/pillar-coverage')
  @RequirePermission(SOCIAL_PLANNER_VIEW_PERMISSION)
  getPillarCoverage(
    @RequestContextData() ctx: RequestContext,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    return this.socialCampaignService.getPillarCoverage(
      this.requireScope(ctx),
      planId,
    );
  }

  // ---------------------------------------------------------------- backlog

  @Get('ideas')
  @RequirePermission(SOCIAL_PLANNER_VIEW_PERMISSION)
  listIdeas(
    @RequestContextData() ctx: RequestContext,
    @Query() query: ListSocialContentIdeasQueryDto,
  ) {
    return this.socialCampaignService.listIdeas(
      this.requireScope(ctx),
      query.status,
    );
  }

  @Post('ideas')
  @RequirePermission(SOCIAL_PLANNER_CREATE_PERMISSION)
  createIdea(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateSocialContentIdeaDto,
  ) {
    return this.socialCampaignService.createIdea(
      this.requireScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  @Patch('ideas/:ideaId')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  updateIdea(
    @RequestContextData() ctx: RequestContext,
    @Param('ideaId', ParseUUIDPipe) ideaId: string,
    @Body() dto: UpdateSocialContentIdeaDto,
  ) {
    return this.socialCampaignService.updateIdea(
      this.requireScope(ctx),
      ideaId,
      ctx.userId ?? null,
      dto,
    );
  }

  @Post('ideas/:ideaId/discard')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  discardIdea(
    @RequestContextData() ctx: RequestContext,
    @Param('ideaId', ParseUUIDPipe) ideaId: string,
  ) {
    return this.socialCampaignService.discardIdea(
      this.requireScope(ctx),
      ideaId,
      ctx.userId ?? null,
    );
  }

  /**
   * Conversion creates planned content, so it requires the CREATE permission
   * rather than the update one that governs editing the idea itself.
   */
  @Post('ideas/:ideaId/convert')
  @RequirePermission(SOCIAL_PLANNER_CREATE_PERMISSION)
  convertIdea(
    @RequestContextData() ctx: RequestContext,
    @Param('ideaId', ParseUUIDPipe) ideaId: string,
    @Body() dto: ConvertSocialContentIdeaDto,
  ) {
    return this.socialCampaignService.convertIdea(
      this.requireScope(ctx),
      ideaId,
      ctx.userId ?? null,
      dto,
    );
  }

  /**
   * Scope comes only from server-resolved request context.
   * The request body cannot select tenant/workspace/client ownership.
   */
  private requireScope(ctx: RequestContext): SocialPlannerScope {
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

  @Get('settings')
  @RequirePermission(SOCIAL_PLANNER_VIEW_PERMISSION)
  getSettings(@RequestContextData() ctx: RequestContext) {
    return this.socialPlannerSettingsService.getSettings(
      this.requireScope(ctx),
    );
  }

  @Patch('settings')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  updateSettings(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpdateSocialPlannerSettingsDto,
  ) {
    return this.socialPlannerSettingsService.updateSettings(
      this.requireScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }

  @Get('cadence')
  @RequirePermission(SOCIAL_PLANNER_VIEW_PERMISSION)
  getCadence(@RequestContextData() ctx: RequestContext) {
    return this.socialPublishingCadenceService.getCadence(
      this.requireScope(ctx),
    );
  }

  @Patch('cadence')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  updateCadence(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: UpdateSocialPublishingCadenceDto,
  ) {
    return this.socialPublishingCadenceService.updateCadence(
      this.requireScope(ctx),
      ctx.userId ?? null,
      dto,
    );
  }
}
