import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import { CreateCrmOpportunityDto } from './dto/create-crm-opportunity.dto';
import { CreateCrmPipelineDto } from './dto/create-crm-pipeline.dto';
import { CreateCrmStageDto } from './dto/create-crm-stage.dto';
import { PatchCrmOpportunityDto } from './dto/patch-crm-opportunity.dto';
import { PatchCrmOpportunityStageDto } from './dto/patch-crm-opportunity-stage.dto';
import { PatchCrmOpportunityStatusDto } from './dto/patch-crm-opportunity-status.dto';
import { PatchCrmPipelineDto } from './dto/patch-crm-pipeline.dto';
import { PatchCrmStageDto } from './dto/patch-crm-stage.dto';
import { AssignCrmOpportunityTagDto } from './dto/assign-crm-opportunity-tag.dto';
import { CreateCrmTagDto } from './dto/create-crm-tag.dto';
import { PatchCrmOpportunityCardColorDto } from './dto/patch-crm-opportunity-card-color.dto';
import { PatchCrmOpportunityAutonomyModeDto } from './dto/patch-crm-opportunity-autonomy-mode.dto';
import { PatchCrmOpportunityFollowDto } from './dto/patch-crm-opportunity-follow.dto';
import { PatchCrmOpportunityVisibilityDto } from './dto/patch-crm-opportunity-visibility.dto';
import { PatchCrmStageFoldDto } from './dto/patch-crm-stage-fold.dto';
import { PatchCrmTagDto } from './dto/patch-crm-tag.dto';
import { ReorderCrmOpportunitiesDto } from './dto/reorder-crm-opportunities.dto';
import { ReorderCrmStagesDto } from './dto/reorder-crm-stages.dto';
import { CrmOpportunityFilters, CrmService } from './crm.service';
import {
  CreateCrmStageTransitionPolicyDto,
  PatchCrmStageTransitionPolicyDto,
} from './dto/crm-stage-transition-policy.dto';
import { CrmStageTransitionPolicyService } from './services/crm-stage-transition-policy.service';
import { CrmOpportunityFieldCatalogService } from './services/crm-opportunity-field-catalog.service';
import { resolveCrmLossReasons } from './catalog/crm-loss-reason.catalog';
import { LeadScoreEngineService } from './lead-score/services/lead-score-engine.service';
import { LeadScoreQueryService } from './lead-score/services/lead-score-query.service';
import { RecalculateLeadScoreDto } from './lead-score/dto/recalculate-lead-score.dto';
import { TransferCrmOpportunityDto } from './dto/transfer-crm-opportunity.dto';
import { CopyCrmOpportunityDto } from './dto/copy-crm-opportunity.dto';
import { ReconvertCrmOpportunityDto } from './dto/reconvert-crm-opportunity.dto';

/** Scope always comes from the authenticated context, never from a body. */
function requireScope(ctx: RequestContext): {
  tenantId: string;
  workspaceId: string;
} {
  if (!ctx.workspaceId) {
    throw new BadRequestException('Workspace context is required.');
  }
  return { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId };
}

@Controller('crm')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class CrmController {
  constructor(
    private readonly crmService: CrmService,
    private readonly transitionPolicies: CrmStageTransitionPolicyService,
    private readonly fieldCatalog: CrmOpportunityFieldCatalogService,
    private readonly leadScoreQuery: LeadScoreQueryService,
    private readonly leadScoreEngine: LeadScoreEngineService,
  ) {}

  /**
   * Current lead score of one opportunity, read from the canonical projection.
   * The breakdown explains the number, so it needs the same visibility as the
   * record itself.
   */
  @Get('opportunities/:id/lead-score')
  @RequirePermission('leadflow.crm.records.view.client')
  getLeadScore(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.leadScoreQuery.getForOpportunity(requireScope(ctx), id, {
      includeBreakdown: true,
    });
  }

  /**
   * Forces a recalculation from canonical state.
   *
   * Accepts a reason and nothing else: no score, no features, no breakdown. The
   * scope comes from the authenticated context, never from the body, so a
   * caller cannot reach another workspace's opportunity.
   */
  @Post('opportunities/:id/lead-score/recalculate')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  recalculateLeadScore(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: RecalculateLeadScoreDto,
  ) {
    return this.leadScoreEngine.recalculate(ctx, {
      opportunityId: id,
      reason: 'manual_recalculation',
      sourceEventName: dto.reason,
    });
  }

  @Get('tags')
  @RequirePermission('leadflow.crm.records.view.client')
  listTags(@RequestContextData() ctx: RequestContext) {
    return this.crmService.listTags(ctx);
  }

  @Post('tags')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  createTag(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateCrmTagDto,
  ) {
    return this.crmService.createTag(ctx, dto);
  }

  @Get('tags/:id')
  @RequirePermission('leadflow.crm.records.view.client')
  getTag(@RequestContextData() ctx: RequestContext, @Param('id') id: string) {
    return this.crmService.getTag(ctx, id);
  }

  @Patch('tags/:id')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  patchTag(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchCrmTagDto,
  ) {
    return this.crmService.patchTag(ctx, id, dto);
  }

  @Delete('tags/:id')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  @DangerousAction()
  deleteTag(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.crmService.deleteTag(ctx, id);
  }

  @Get('pipelines')
  @RequirePermission('leadflow.crm.records.view.client')
  listPipelines(@RequestContextData() ctx: RequestContext) {
    return this.crmService.listPipelines(ctx);
  }

  @Post('pipelines')
  @RequirePermission('leadflow.crm.pipeline.manage.admin')
  createPipeline(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateCrmPipelineDto,
  ) {
    return this.crmService.createPipeline(ctx, dto);
  }

  @Get('pipelines/:id')
  @RequirePermission('leadflow.crm.records.view.client')
  getPipeline(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.crmService.getPipeline(ctx, id);
  }

  @Patch('pipelines/:id')
  @RequirePermission('leadflow.crm.pipeline.manage.admin')
  patchPipeline(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchCrmPipelineDto,
  ) {
    return this.crmService.patchPipeline(ctx, id, dto);
  }

  @Delete('pipelines/:id')
  @RequirePermission('leadflow.crm.pipeline.manage.admin')
  @DangerousAction()
  deletePipeline(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.crmService.deletePipeline(ctx, id);
  }

  /**
   * Fields a transition policy may require, named for an operator.
   *
   * `businessMode` selects which qualification fields the client declared; the
   * response says whether it actually resolved, so the UI can distinguish "this
   * mode has no qualification fields" from "we could not find the mode".
   */
  @Get('opportunity-fields')
  @RequirePermission('leadflow.crm.records.view.client')
  listOpportunityFields(
    @RequestContextData() ctx: RequestContext,
    @Query('businessMode') businessMode?: string,
  ) {
    return this.fieldCatalog.listFields(ctx, businessMode ?? null);
  }

  /**
   * Standardised loss reasons for a Business Mode, so a lost transition records
   * a code Analytics can count rather than free text. The mode's own reasons
   * come first, then the shared ones; an unknown mode still gets the shared set.
   */
  @Get('loss-reasons')
  @RequirePermission('leadflow.crm.records.view.client')
  listLossReasons(@Query('businessMode') businessMode?: string) {
    return {
      businessMode: businessMode ?? null,
      reasons: resolveCrmLossReasons(businessMode ?? null),
    };
  }

  /**
   * Destinations an automation may target in a pipeline, for configuring the
   * governed stage-advance recipe. Only edges a published policy admits for the
   * automation actor, to non-terminal stages.
   */
  @Get('pipelines/:id/automation-transitions')
  @RequirePermission('leadflow.crm.records.view.client')
  listAutomationTransitions(
    @RequestContextData() ctx: RequestContext,
    @Param('id') pipelineId: string,
  ) {
    return this.transitionPolicies.getAutomationDestinations(ctx, pipelineId);
  }

  @Get('stage-transition-policies')
  @RequirePermission('leadflow.crm.records.view.client')
  listStageTransitionPolicies(
    @RequestContextData() ctx: RequestContext,
    @Query('pipelineId') pipelineId: string,
  ) {
    return this.transitionPolicies.list(ctx, pipelineId);
  }

  /**
   * Republishes the movements a pipeline admits by default, filling only the
   * pairs that have no policy at all. An operator who narrowed or removed a
   * transition keeps that decision.
   */
  @Post('pipelines/:id/stage-transition-defaults')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  restoreStageTransitionDefaults(
    @RequestContextData() ctx: RequestContext,
    @Param('id') pipelineId: string,
  ) {
    return this.transitionPolicies.ensureDefaultPolicies(ctx, pipelineId);
  }

  @Post('stage-transition-policies')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  createStageTransitionPolicy(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateCrmStageTransitionPolicyDto,
  ) {
    return this.transitionPolicies.createDraft(ctx, dto);
  }

  @Patch('stage-transition-policies/:id')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  patchStageTransitionPolicy(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchCrmStageTransitionPolicyDto,
  ) {
    return this.transitionPolicies.patchDraft(ctx, id, dto);
  }

  @Post('stage-transition-policies/:id/publish')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  publishStageTransitionPolicy(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.transitionPolicies.publish(ctx, id);
  }

  @Post('stage-transition-policies/:id/deactivate')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  deactivateStageTransitionPolicy(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.transitionPolicies.deactivate(ctx, id);
  }

  @Delete('stage-transition-policies/:id')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  @DangerousAction()
  deleteStageTransitionPolicy(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.transitionPolicies.deleteDraft(ctx, id);
  }

  @Get('stages')
  @RequirePermission('leadflow.crm.records.view.client')
  listStages(
    @RequestContextData() ctx: RequestContext,
    @Query('pipelineId') pipelineId?: string,
  ) {
    return this.crmService.listStages(ctx, pipelineId);
  }

  @Post('stages')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  createStage(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateCrmStageDto,
  ) {
    return this.crmService.createStage(ctx, dto);
  }

  @Patch('stages/reorder')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  reorderStages(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: ReorderCrmStagesDto,
  ) {
    return this.crmService.reorderStages(ctx, dto);
  }

  @Get('stages/:id')
  @RequirePermission('leadflow.crm.records.view.client')
  getStage(@RequestContextData() ctx: RequestContext, @Param('id') id: string) {
    return this.crmService.getStage(ctx, id);
  }

  @Patch('stages/:id')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  patchStage(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchCrmStageDto,
  ) {
    return this.crmService.patchStage(ctx, id, dto);
  }

  @Patch('stages/:id/fold')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  patchStageFold(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchCrmStageFoldDto,
  ) {
    return this.crmService.patchStageFold(ctx, id, dto);
  }

  @Delete('stages/:id')
  @RequirePermission('leadflow.crm.stage.manage.manager_or_admin')
  @DangerousAction()
  deleteStage(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.crmService.deleteStage(ctx, id);
  }

  @Get('opportunities')
  @RequirePermission('leadflow.crm.records.view.client')
  listOpportunities(
    @RequestContextData() ctx: RequestContext,
    @Query('pipelineId') pipelineId?: string,
    @Query('stageId') stageId?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('source') source?: string,
    @Query('businessMode') businessMode?: string,
    @Query('assignedUserId') assignedUserId?: string,
    @Query('contactId') contactId?: string,
    @Query('inboxConversationId') inboxConversationId?: string,
    @Query('q') q?: string,
  ) {
    const filters: CrmOpportunityFilters = {
      pipelineId,
      stageId,
      status,
      priority,
      source,
      businessMode,
      assignedUserId,
      contactId,
      inboxConversationId,
      search: q,
    };

    return this.crmService.listOpportunities(ctx, filters);
  }

  @Post('opportunities')
  @RequirePermission('leadflow.crm.records.create.client')
  createOpportunity(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateCrmOpportunityDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.crmService.createOpportunity(ctx, dto, { idempotencyKey });
  }

  @Patch('opportunities/reorder')
  @RequireAnyPermission(
    'leadflow.crm.records.update.assigned',
    'leadflow.crm.records.update.client',
  )
  reorderOpportunities(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: ReorderCrmOpportunitiesDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.crmService.reorderOpportunities(ctx, dto, { idempotencyKey });
  }

  @Get('opportunities/:id')
  @RequireAnyPermission(
    'leadflow.crm.records.view.assigned',
    'leadflow.crm.records.view.client',
  )
  getOpportunity(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.crmService.getOpportunity(ctx, id);
  }

  @Patch('opportunities/:id')
  @RequireAnyPermission(
    'leadflow.crm.records.update.assigned',
    'leadflow.crm.records.update.client',
  )
  patchOpportunity(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchCrmOpportunityDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.crmService.patchOpportunity(ctx, id, dto, { idempotencyKey });
  }

  @Patch('opportunities/:id/stage')
  @RequireAnyPermission(
    'leadflow.crm.records.update.assigned',
    'leadflow.crm.records.update.client',
  )
  patchOpportunityStage(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchCrmOpportunityStageDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.crmService.patchOpportunityStage(ctx, id, dto, {
      idempotencyKey,
    });
  }

  @Post('opportunities/:id/transfer')
  @RequireAnyPermission(
    'leadflow.crm.records.update.assigned',
    'leadflow.crm.records.update.client',
  )
  transferOpportunity(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: TransferCrmOpportunityDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.crmService.transferOpportunity(ctx, id, dto, {
      idempotencyKey,
    });
  }

  @Post('opportunities/:id/copy')
  @RequirePermission('leadflow.crm.records.create.client')
  copyOpportunity(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CopyCrmOpportunityDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.crmService.copyOpportunity(ctx, id, dto, {
      idempotencyKey,
    });
  }

  @Post('opportunities/:id/reconvert')
  @RequirePermission('leadflow.crm.records.create.client')
  reconvertOpportunity(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: ReconvertCrmOpportunityDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.crmService.reconvertOpportunity(ctx, id, dto, {
      idempotencyKey,
    });
  }

  @Patch('opportunities/:id/status')
  @RequireAnyPermission(
    'leadflow.crm.records.update.assigned',
    'leadflow.crm.records.update.client',
  )
  patchOpportunityStatus(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchCrmOpportunityStatusDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.crmService.patchOpportunityStatus(ctx, id, dto, {
      idempotencyKey,
    });
  }

  @Patch('opportunities/:id/card-color')
  @RequireAnyPermission(
    'leadflow.crm.records.update.assigned',
    'leadflow.crm.records.update.client',
  )
  patchOpportunityCardColor(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchCrmOpportunityCardColorDto,
  ) {
    return this.crmService.patchOpportunityCardColor(ctx, id, dto);
  }

  @Patch('opportunities/:id/follow')
  @RequireAnyPermission(
    'leadflow.crm.records.update.assigned',
    'leadflow.crm.records.update.client',
  )
  patchOpportunityFollow(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchCrmOpportunityFollowDto,
  ) {
    return this.crmService.patchOpportunityFollow(ctx, id, dto);
  }

  /**
   * D3: set the card's autonomy mode. Moving a LeadFlow card by hand already
   * flips it to `manual`; this endpoint lets an operator reactivate `automatic`
   * (or set `manual` explicitly). Audited via the autonomy_mode.changed event.
   */
  @Patch('opportunities/:id/autonomy-mode')
  @RequireAnyPermission(
    'leadflow.crm.records.update.assigned',
    'leadflow.crm.records.update.client',
  )
  patchOpportunityAutonomyMode(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchCrmOpportunityAutonomyModeDto,
  ) {
    return this.crmService.setOpportunityAutonomyMode(ctx, id, dto);
  }

  @Patch('opportunities/:id/visibility')
  @RequireAnyPermission(
    'leadflow.crm.records.update.assigned',
    'leadflow.crm.records.update.client',
  )
  patchOpportunityVisibility(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: PatchCrmOpportunityVisibilityDto,
  ) {
    return this.crmService.patchOpportunityVisibility(ctx, id, dto);
  }

  @Get('opportunities/:id/tags')
  @RequireAnyPermission(
    'leadflow.crm.records.view.assigned',
    'leadflow.crm.records.view.client',
  )
  listOpportunityTags(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.crmService.listOpportunityTags(ctx, id);
  }

  @Post('opportunities/:id/tags')
  @RequireAnyPermission(
    'leadflow.crm.records.update.assigned',
    'leadflow.crm.records.update.client',
  )
  assignOpportunityTag(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: AssignCrmOpportunityTagDto,
  ) {
    return this.crmService.assignOpportunityTag(ctx, id, dto);
  }

  @Delete('opportunities/:id/tags/:tagId')
  @RequireAnyPermission(
    'leadflow.crm.records.update.assigned',
    'leadflow.crm.records.update.client',
  )
  @DangerousAction()
  removeOpportunityTag(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    return this.crmService.removeOpportunityTag(ctx, id, tagId);
  }

  @Get('opportunities/:id/events')
  @RequireAnyPermission(
    'leadflow.crm.records.view.assigned',
    'leadflow.crm.records.view.client',
  )
  listOpportunityEvents(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.crmService.listOpportunityEvents(ctx, id);
  }

  @Delete('opportunities/:id')
  @RequirePermission('leadflow.crm.records.delete.owner_or_admin_explicit')
  @DangerousAction()
  deleteOpportunity(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
  ) {
    return this.crmService.deleteOpportunity(ctx, id);
  }
}
