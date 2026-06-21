import {
  Body,
  Controller,
  Delete,
  Get,
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
import { CreateCrmOpportunityEventDto } from './dto/create-crm-opportunity-event.dto';
import { CreateCrmTagDto } from './dto/create-crm-tag.dto';
import { PatchCrmOpportunityCardColorDto } from './dto/patch-crm-opportunity-card-color.dto';
import { PatchCrmOpportunityFollowDto } from './dto/patch-crm-opportunity-follow.dto';
import { PatchCrmOpportunityVisibilityDto } from './dto/patch-crm-opportunity-visibility.dto';
import { PatchCrmStageFoldDto } from './dto/patch-crm-stage-fold.dto';
import { PatchCrmTagDto } from './dto/patch-crm-tag.dto';
import { ReorderCrmStagesDto } from './dto/reorder-crm-stages.dto';
import { CrmOpportunityFilters, CrmService } from './crm.service';

@Controller('crm')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

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
  ) {
    return this.crmService.createOpportunity(ctx, dto);
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
  ) {
    return this.crmService.patchOpportunity(ctx, id, dto);
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
  ) {
    return this.crmService.patchOpportunityStage(ctx, id, dto);
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
  ) {
    return this.crmService.patchOpportunityStatus(ctx, id, dto);
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

  @Post('opportunities/:id/events')
  @RequireAnyPermission(
    'leadflow.crm.records.update.assigned',
    'leadflow.crm.records.update.client',
  )
  createOpportunityEvent(
    @RequestContextData() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: CreateCrmOpportunityEventDto,
  ) {
    return this.crmService.createOpportunityEvent(ctx, id, dto);
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
