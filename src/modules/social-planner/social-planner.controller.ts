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
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  DangerousAction,
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
  ListSocialPlanContentQueryDto,
  SocialContentBatchDto,
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
import { SocialContentLifecycleService } from './services/social-content-lifecycle.service';
import { SocialPlannerSettingsService } from './services/social-planner-settings.service';
import { SocialPublishingCadenceService } from './services/social-publishing-cadence.service';

const SOCIAL_PLANNER_VIEW_PERMISSION = 'social.planner.calendar.view.client';

const SOCIAL_PLANNER_CREATE_PERMISSION =
  'social.planner.calendar.create.manager';

const SOCIAL_PLANNER_UPDATE_PERMISSION =
  'social.planner.calendar.update.manager';

/**
 * Owner-only and explicit, already in the catalog before this etapa — so E6
 * introduces no permission and needs no permission migration.
 */
const SOCIAL_PLANNER_DELETE_PERMISSION =
  'social.planner.calendar.delete.owner_or_admin_explicit';

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
    private readonly socialContentLifecycleService: SocialContentLifecycleService,
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
    @Query() query: ListSocialPlanContentQueryDto,
  ) {
    return this.socialPlannerService.listContent(
      this.requireScope(ctx),
      planId,
      /**
       * Defaulting here rather than in the service keeps the omitted-parameter
       * behaviour identical to what every existing caller already sees.
       */
      query.archived ?? 'exclude',
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

  // ------------------------------------------------- lifecycle actions (E6)

  /**
   * Duplicating creates content, so it answers to the CREATE permission — the
   * same reasoning that governs converting an idea.
   */
  @Post('content/:contentId/duplicate')
  @RequirePermission(SOCIAL_PLANNER_CREATE_PERMISSION)
  duplicateContent(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    return this.socialContentLifecycleService.duplicate(
      this.requireScope(ctx),
      contentId,
      ctx.userId ?? null,
    );
  }

  /**
   * Archive and restore are the UPDATE permission, not the delete one.
   *
   * Both are fully reversible and destroy nothing: an archived item keeps every
   * field, every destination and every revision, and any manager who may edit
   * content may tidy it away and bring it back. Charging them to the owner-only
   * delete key would make routine housekeeping need an owner.
   */
  @Post('content/:contentId/archive')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  archiveContent(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    return this.socialContentLifecycleService.archive(
      this.requireScope(ctx),
      contentId,
      ctx.userId ?? null,
    );
  }

  @Post('content/:contentId/restore')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  restoreContent(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ) {
    return this.socialContentLifecycleService.restore(
      this.requireScope(ctx),
      contentId,
      ctx.userId ?? null,
    );
  }

  /**
   * Delete answers to `social.planner.calendar.delete.owner_or_admin_explicit`,
   * which already existed in the catalog as owner-only and explicit — so this
   * etapa adds no permission and no permission migration.
   *
   * 204 with no body: there is no post-delete state worth returning, and
   * echoing the soft-deleted row would invite a caller to keep using it.
   */
  @Delete('content/:contentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(SOCIAL_PLANNER_DELETE_PERMISSION)
  @DangerousAction()
  async removeContent(
    @RequestContextData() ctx: RequestContext,
    @Param('contentId', ParseUUIDPipe) contentId: string,
  ): Promise<void> {
    await this.socialContentLifecycleService.remove(
      this.requireScope(ctx),
      contentId,
      ctx.userId ?? null,
    );
  }

  // ----------------------------------------------------- batch actions (E6)

  /**
   * Batch endpoints take the ids in a body and always answer 200 with a
   * per-item verdict, including when every item failed.
   *
   * A batch is not an all-or-nothing operation, so an HTTP status cannot
   * describe it: 207-style reporting in the body is the only honest answer
   * when nine items succeeded and three were refused. The alternative — one
   * request per item — is what E6 explicitly rules out, because it gives the
   * caller no control over what happened in between.
   *
   * `POST` for delete-many rather than `DELETE`: a request body on DELETE is
   * legal but is dropped by enough proxies and clients that the selection would
   * silently arrive empty.
   */
  @Post('content/batch/archive')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  archiveContentBatch(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SocialContentBatchDto,
  ) {
    return this.socialContentLifecycleService.archiveMany(
      this.requireScope(ctx),
      dto.contentIds,
      ctx.userId ?? null,
    );
  }

  @Post('content/batch/restore')
  @RequirePermission(SOCIAL_PLANNER_UPDATE_PERMISSION)
  restoreContentBatch(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SocialContentBatchDto,
  ) {
    return this.socialContentLifecycleService.restoreMany(
      this.requireScope(ctx),
      dto.contentIds,
      ctx.userId ?? null,
    );
  }

  @Post('content/batch/delete')
  @RequirePermission(SOCIAL_PLANNER_DELETE_PERMISSION)
  @DangerousAction()
  removeContentBatch(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SocialContentBatchDto,
  ) {
    return this.socialContentLifecycleService.removeMany(
      this.requireScope(ctx),
      dto.contentIds,
      ctx.userId ?? null,
    );
  }

  /**
   * The plan's content as CSV.
   *
   * `VIEW` permission: the export contains exactly the columns the Planning
   * table already shows to the same reader, so requiring more than reading
   * would be theatre. What keeps it safe is what the serializer leaves out and
   * neutralizes, not a stricter key.
   */
  @Get('plans/:planId/content/export')
  @RequirePermission(SOCIAL_PLANNER_VIEW_PERMISSION)
  async exportPlanContent(
    @RequestContextData() ctx: RequestContext,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Query() query: ListSocialPlanContentQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const csv = await this.socialContentLifecycleService.exportPlanContentCsv(
      this.requireScope(ctx),
      planId,
      query.archived ?? 'exclude',
    );

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="social-planner-content-${planId}.csv"`,
    );

    return csv;
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
