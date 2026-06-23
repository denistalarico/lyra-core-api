import {
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
import { AuthenticatedUser } from '../auth/decorators/authenticated-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../auth/types/auth-token-payload.type';
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
} from '../permissions';
import {
  AgencySalesListQueryDto,
  CompleteAgencySalesActivityDto,
  CreateAgencySalesActivityDto,
  CreateAgencySalesItemDto,
  CreateAgencySalesOpportunityDto,
  CreateAgencySalesOpportunityItemDto,
  CreateAgencySalesPipelineDto,
  CreateAgencySalesQuickOpportunityDto,
  CreateAgencySalesStageDto,
  MoveAgencySalesOpportunityDto,
  ReorderAgencySalesStagesDto,
  UpdateAgencySalesItemDto,
  UpdateAgencySalesActivityDto,
  UpdateAgencySalesOpportunityDto,
  UpdateAgencySalesOpportunityItemDto,
  UpdateAgencySalesPipelineDto,
  UpdateAgencySalesProductSettingsDto,
  UpdateAgencySalesStageDto,
} from './dto/agency-sales.dto';
import { AgencySalesService } from './agency-sales.service';

type AgencyContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string;
};

@Controller('agency/sales')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AgencySalesController {
  constructor(private readonly salesService: AgencySalesService) {}

  @Get('health')
  health() {
    return this.salesService.health();
  }

  @Get('overview')
  @RequirePermission('agency.sales.crm.view.department')
  overview(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.salesService.getOverview(this.getContext(user, workspaceId));
  }

  @Post('items')
  @RequirePermission('agency.sales.products.manage.admin')
  createItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() dto: CreateAgencySalesItemDto,
  ) {
    return this.salesService.createItem(
      this.getContext(user, workspaceId),
      dto,
    );
  }

  @Get('items')
  @RequirePermission('agency.sales.products.manage.admin')
  listItems(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Query() query: AgencySalesListQueryDto,
  ) {
    return this.salesService.listItems(
      this.getContext(user, workspaceId),
      query.search,
    );
  }

  @Patch('items/:id')
  @RequirePermission('agency.sales.products.manage.admin')
  updateItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateAgencySalesItemDto,
  ) {
    return this.salesService.updateItem(
      this.getContext(user, workspaceId),
      id,
      dto,
    );
  }

  @Delete('items/:id')
  @RequirePermission('agency.sales.products.manage.admin')
  @DangerousAction()
  deleteItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.salesService.deleteItem(this.getContext(user, workspaceId), id);
  }

  @Get('product-settings')
  @RequirePermission('agency.sales.products.manage.admin')
  getProductSettings(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.salesService.getProductSettings(
      this.getContext(user, workspaceId),
    );
  }

  @Patch('product-settings')
  @RequirePermission('agency.sales.products.manage.admin')
  updateProductSettings(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() dto: UpdateAgencySalesProductSettingsDto,
  ) {
    return this.salesService.updateProductSettings(
      this.getContext(user, workspaceId),
      dto,
    );
  }

  @Post('pipelines')
  @RequirePermission('agency.sales.pipeline.manage.admin')
  createPipeline(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() dto: CreateAgencySalesPipelineDto,
  ) {
    return this.salesService.createPipeline(
      this.getContext(user, workspaceId),
      dto,
    );
  }

  @Get('pipelines')
  @RequirePermission('agency.sales.pipeline.manage.admin')
  listPipelines(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.salesService.listPipelines(this.getContext(user, workspaceId));
  }

  @Patch('pipelines/:id')
  @RequirePermission('agency.sales.pipeline.manage.admin')
  updatePipeline(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateAgencySalesPipelineDto,
  ) {
    return this.salesService.updatePipeline(
      this.getContext(user, workspaceId),
      id,
      dto,
    );
  }

  @Delete('pipelines/:id')
  @RequirePermission('agency.sales.pipeline.manage.admin')
  @DangerousAction()
  deletePipeline(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.salesService.deletePipeline(
      this.getContext(user, workspaceId),
      id,
    );
  }

  @Post('stages')
  @RequirePermission('agency.sales.stages.manage.manager_or_admin')
  createStage(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() dto: CreateAgencySalesStageDto,
  ) {
    return this.salesService.createStage(
      this.getContext(user, workspaceId),
      dto,
    );
  }

  @Patch('stages/reorder')
  @RequirePermission('agency.sales.stages.manage.manager_or_admin')
  reorderStages(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() dto: ReorderAgencySalesStagesDto,
  ) {
    return this.salesService.reorderStages(
      this.getContext(user, workspaceId),
      dto,
    );
  }

  @Patch('stages/:id')
  @RequirePermission('agency.sales.stages.manage.manager_or_admin')
  updateStage(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateAgencySalesStageDto,
  ) {
    return this.salesService.updateStage(
      this.getContext(user, workspaceId),
      id,
      dto,
    );
  }

  @Get('defaults')
  @RequireAnyPermission(
    'agency.sales.crm.view.assigned',
    'agency.sales.crm.view.department',
  )
  defaults(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.salesService.getDefaults(this.getContext(user, workspaceId));
  }

  @Post('opportunities/quick')
  @RequirePermission('agency.sales.crm.manage.department')
  createQuickOpportunity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() dto: CreateAgencySalesQuickOpportunityDto,
  ) {
    return this.salesService.createQuickOpportunity(
      this.getContext(user, workspaceId),
      dto,
    );
  }

  @Post('opportunities')
  @RequirePermission('agency.sales.crm.manage.department')
  createOpportunity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() dto: CreateAgencySalesOpportunityDto,
  ) {
    return this.salesService.createOpportunity(
      this.getContext(user, workspaceId),
      dto,
    );
  }

  @Get('opportunities')
  @RequirePermission('agency.sales.crm.view.department')
  listOpportunities(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.salesService.listOpportunities(
      this.getContext(user, workspaceId),
    );
  }

  @Get('opportunities/:id/activities')
  @RequireAnyPermission(
    'agency.sales.crm.view.assigned',
    'agency.sales.crm.view.department',
  )
  listOpportunityActivities(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.salesService.listOpportunityActivities(
      this.getContext(user, workspaceId),
      id,
    );
  }

  @Post('opportunities/:id/activities')
  @RequirePermission('agency.sales.crm.manage.department')
  createOpportunityActivity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() dto: CreateAgencySalesActivityDto,
  ) {
    return this.salesService.createOpportunityActivity(
      this.getContext(user, workspaceId),
      id,
      dto,
    );
  }

  @Patch('opportunities/:id/activities/:activityId')
  @RequireAnyPermission(
    'agency.sales.contacts.update.assigned',
    'agency.sales.crm.manage.department',
  )
  updateOpportunityActivity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Param('activityId') activityId: string,
    @Body() dto: UpdateAgencySalesActivityDto,
  ) {
    return this.salesService.updateOpportunityActivity(
      this.getContext(user, workspaceId),
      id,
      activityId,
      dto,
    );
  }

  @Patch('opportunities/:id/activities/:activityId/complete')
  @RequireAnyPermission(
    'agency.sales.contacts.update.assigned',
    'agency.sales.crm.manage.department',
  )
  completeOpportunityActivity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Param('activityId') activityId: string,
    @Body() dto: CompleteAgencySalesActivityDto,
  ) {
    return this.salesService.completeOpportunityActivity(
      this.getContext(user, workspaceId),
      id,
      activityId,
      dto,
    );
  }

  @Delete('opportunities/:id/activities/:activityId')
  @RequirePermission('agency.sales.crm.manage.department')
  @DangerousAction()
  deleteOpportunityActivity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Param('activityId') activityId: string,
  ) {
    return this.salesService.deleteOpportunityActivity(
      this.getContext(user, workspaceId),
      id,
      activityId,
    );
  }

  @Get('opportunities/kanban')
  @RequirePermission('agency.sales.crm.view.department')
  getOpportunitiesKanban(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Query('pipelineId') pipelineId?: string,
  ) {
    return this.salesService.getOpportunitiesKanban(
      this.getContext(user, workspaceId),
      pipelineId,
    );
  }

  @Patch('opportunities/:id/move')
  @RequirePermission('agency.sales.crm.manage.department')
  moveOpportunity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() dto: MoveAgencySalesOpportunityDto,
  ) {
    return this.salesService.moveOpportunity(
      this.getContext(user, workspaceId),
      id,
      dto,
    );
  }

  @Get('opportunities/:id/items')
  @RequireAnyPermission(
    'agency.sales.crm.view.assigned',
    'agency.sales.crm.view.department',
  )
  listOpportunityItems(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.salesService.listOpportunityItems(
      this.getContext(user, workspaceId),
      id,
    );
  }

  @Post('opportunities/:id/items')
  @RequirePermission('agency.sales.crm.manage.department')
  createOpportunityItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() dto: CreateAgencySalesOpportunityItemDto,
  ) {
    return this.salesService.createOpportunityItem(
      this.getContext(user, workspaceId),
      id,
      dto,
    );
  }

  @Patch('opportunities/:id/items/:itemId')
  @RequirePermission('agency.sales.crm.manage.department')
  updateOpportunityItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateAgencySalesOpportunityItemDto,
  ) {
    return this.salesService.updateOpportunityItem(
      this.getContext(user, workspaceId),
      id,
      itemId,
      dto,
    );
  }

  @Delete('opportunities/:id/items/:itemId')
  @RequirePermission('agency.sales.crm.manage.department')
  @DangerousAction()
  deleteOpportunityItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.salesService.deleteOpportunityItem(
      this.getContext(user, workspaceId),
      id,
      itemId,
    );
  }

  @Patch('opportunities/:id')
  @RequirePermission('agency.sales.crm.manage.department')
  updateOpportunity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateAgencySalesOpportunityDto,
  ) {
    return this.salesService.updateOpportunity(
      this.getContext(user, workspaceId),
      id,
      dto,
    );
  }

  @Delete('opportunities/:id')
  @RequirePermission('agency.sales.crm.manage.department')
  @DangerousAction()
  deleteOpportunity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.salesService.deleteOpportunity(
      this.getContext(user, workspaceId),
      id,
    );
  }

  @Get('opportunities/:id')
  @RequireAnyPermission(
    'agency.sales.crm.view.assigned',
    'agency.sales.crm.view.department',
  )
  getOpportunityDetail(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.salesService.getOpportunityDetail(
      this.getContext(user, workspaceId),
      id,
    );
  }

  private getContext(
    user: AuthTokenPayload,
    workspaceId?: string,
  ): AgencyContext {
    return {
      tenantId: user.tenantId,
      workspaceId: workspaceId ?? user.workspaceId,
      userId: user.sub,
    };
  }
}
