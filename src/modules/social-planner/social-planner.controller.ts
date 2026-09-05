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
  CreateSocialContentItemDto,
  CreateSocialPlanDto,
  UpdateSocialContentItemDto,
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
import { SocialPlannerSettingsService } from './services/social-planner-settings.service';
import { SocialPublishingCadenceService } from './services/social-publishing-cadence.service';

const SOCIAL_PLANNER_VIEW_PERMISSION = 'social.planner.calendar.view.client';

const SOCIAL_PLANNER_CREATE_PERMISSION =
  'social.planner.calendar.create.manager';

const SOCIAL_PLANNER_UPDATE_PERMISSION =
  'social.planner.calendar.update.manager';

@Controller('social/planner')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('social')
export class SocialPlannerController {
  constructor(
    private readonly socialPlannerService: SocialPlannerService,
    private readonly socialPlannerSettingsService: SocialPlannerSettingsService,
    private readonly socialPublishingCadenceService: SocialPublishingCadenceService,
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
