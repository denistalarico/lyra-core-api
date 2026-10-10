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
  overview(@AuthenticatedUser() user: AuthTokenPayload) {
    return this.salesService.getOverview(this.getContext(user));
  }

  @Post('items')
  @RequirePermission('agency.sales.products.manage.admin')
  createItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Body() dto: CreateAgencySalesItemDto,
  ) {
    return this.salesService.createItem(this.getContext(user), dto);
  }

  @Get('items')
  @RequirePermission('agency.sales.products.manage.admin')
  listItems(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Query() query: AgencySalesListQueryDto,
  ) {
    return this.salesService.listItems(this.getContext(user), query.search);
  }

  @Patch('items/:id')
  @RequirePermission('agency.sales.products.manage.admin')
  updateItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAgencySalesItemDto,
  ) {
    return this.salesService.updateItem(this.getContext(user), id, dto);
  }

  @Delete('items/:id')
  @RequirePermission('agency.sales.products.manage.admin')
  @DangerousAction()
  deleteItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('id') id: string,
  ) {
    return this.salesService.deleteItem(this.getContext(user), id);
  }

  @Get('product-settings')
  @RequirePermission('agency.sales.products.manage.admin')
  getProductSettings(@AuthenticatedUser() user: AuthTokenPayload) {
    return this.salesService.getProductSettings(this.getContext(user));
  }

  @Patch('product-settings')
  @RequirePermission('agency.sales.products.manage.admin')
  updateProductSettings(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Body() dto: UpdateAgencySalesProductSettingsDto,
  ) {
    return this.salesService.updateProductSettings(this.getContext(user), dto);
  }

  @Post('pipelines')
  @RequirePermission('agency.sales.pipeline.manage.admin')
  createPipeline(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Body() dto: CreateAgencySalesPipelineDto,
  ) {
    return this.salesService.createPipeline(this.getContext(user), dto);
  }

  @Get('pipelines')
  @RequirePermission('agency.sales.pipeline.manage.admin')
  listPipelines(@AuthenticatedUser() user: AuthTokenPayload) {
    return this.salesService.listPipelines(this.getContext(user));
  }

  @Patch('pipelines/:id')
  @RequirePermission('agency.sales.pipeline.manage.admin')
  updatePipeline(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAgencySalesPipelineDto,
  ) {
    return this.salesService.updatePipeline(this.getContext(user), id, dto);
  }

  @Delete('pipelines/:id')
  @RequirePermission('agency.sales.pipeline.manage.admin')
  @DangerousAction()
  deletePipeline(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('id') id: string,
  ) {
    return this.salesService.deletePipeline(this.getContext(user), id);
  }

  @Post('stages')
  @RequirePermission('agency.sales.stages.manage.manager_or_admin')
  createStage(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Body() dto: CreateAgencySalesStageDto,
  ) {
    return this.salesService.createStage(this.getContext(user), dto);
  }

  @Patch('stages/reorder')
  @RequirePermission('agency.sales.stages.manage.manager_or_admin')
  reorderStages(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Body() dto: ReorderAgencySalesStagesDto,
  ) {
    return this.salesService.reorderStages(this.getContext(user), dto);
  }

  @Patch('stages/:id')
  @RequirePermission('agency.sales.stages.manage.manager_or_admin')
  updateStage(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAgencySalesStageDto,
  ) {
    return this.salesService.updateStage(this.getContext(user), id, dto);
  }

  @Get('defaults')
  @RequireAnyPermission(
    'agency.sales.crm.view.assigned',
    'agency.sales.crm.view.department',
  )
  defaults(@AuthenticatedUser() user: AuthTokenPayload) {
    return this.salesService.getDefaults(this.getContext(user));
  }

  @Post('opportunities/quick')
  @RequirePermission('agency.sales.crm.manage.department')
  createQuickOpportunity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Body() dto: CreateAgencySalesQuickOpportunityDto,
  ) {
    return this.salesService.createQuickOpportunity(this.getContext(user), dto);
  }

  @Post('opportunities')
  @RequirePermission('agency.sales.crm.manage.department')
  createOpportunity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Body() dto: CreateAgencySalesOpportunityDto,
  ) {
    return this.salesService.createOpportunity(this.getContext(user), dto);
  }

  @Get('opportunities')
  @RequirePermission('agency.sales.crm.view.department')
  listOpportunities(@AuthenticatedUser() user: AuthTokenPayload) {
    return this.salesService.listOpportunities(this.getContext(user));
  }

  @Get('opportunities/:id/activities')
  @RequireAnyPermission(
    'agency.sales.crm.view.assigned',
    'agency.sales.crm.view.department',
  )
  listOpportunityActivities(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('id') id: string,
  ) {
    return this.salesService.listOpportunityActivities(
      this.getContext(user),
      id,
    );
  }

  @Post('opportunities/:id/activities')
  @RequirePermission('agency.sales.crm.manage.department')
  createOpportunityActivity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreateAgencySalesActivityDto,
  ) {
    return this.salesService.createOpportunityActivity(
      this.getContext(user),
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
    @Param('id') id: string,
    @Param('activityId') activityId: string,
    @Body() dto: UpdateAgencySalesActivityDto,
  ) {
    return this.salesService.updateOpportunityActivity(
      this.getContext(user),
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
    @Param('id') id: string,
    @Param('activityId') activityId: string,
    @Body() dto: CompleteAgencySalesActivityDto,
  ) {
    return this.salesService.completeOpportunityActivity(
      this.getContext(user),
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
    @Param('id') id: string,
    @Param('activityId') activityId: string,
  ) {
    return this.salesService.deleteOpportunityActivity(
      this.getContext(user),
      id,
      activityId,
    );
  }

  @Get('opportunities/kanban')
  @RequirePermission('agency.sales.crm.view.department')
  getOpportunitiesKanban(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Query('pipelineId') pipelineId?: string,
  ) {
    return this.salesService.getOpportunitiesKanban(
      this.getContext(user),
      pipelineId,
    );
  }

  @Patch('opportunities/:id/move')
  @RequirePermission('agency.sales.crm.manage.department')
  moveOpportunity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body() dto: MoveAgencySalesOpportunityDto,
  ) {
    return this.salesService.moveOpportunity(this.getContext(user), id, dto);
  }

  @Get('opportunities/:id/items')
  @RequireAnyPermission(
    'agency.sales.crm.view.assigned',
    'agency.sales.crm.view.department',
  )
  listOpportunityItems(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('id') id: string,
  ) {
    return this.salesService.listOpportunityItems(this.getContext(user), id);
  }

  @Post('opportunities/:id/items')
  @RequirePermission('agency.sales.crm.manage.department')
  createOpportunityItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body() dto: CreateAgencySalesOpportunityItemDto,
  ) {
    return this.salesService.createOpportunityItem(
      this.getContext(user),
      id,
      dto,
    );
  }

  @Patch('opportunities/:id/items/:itemId')
  @RequirePermission('agency.sales.crm.manage.department')
  updateOpportunityItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateAgencySalesOpportunityItemDto,
  ) {
    return this.salesService.updateOpportunityItem(
      this.getContext(user),
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
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.salesService.deleteOpportunityItem(
      this.getContext(user),
      id,
      itemId,
    );
  }

  @Patch('opportunities/:id')
  @RequirePermission('agency.sales.crm.manage.department')
  updateOpportunity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAgencySalesOpportunityDto,
  ) {
    return this.salesService.updateOpportunity(this.getContext(user), id, dto);
  }

  @Delete('opportunities/:id')
  @RequirePermission('agency.sales.crm.manage.department')
  @DangerousAction()
  deleteOpportunity(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('id') id: string,
  ) {
    return this.salesService.deleteOpportunity(this.getContext(user), id);
  }

  @Get('opportunities/:id')
  @RequireAnyPermission(
    'agency.sales.crm.view.assigned',
    'agency.sales.crm.view.department',
  )
  getOpportunityDetail(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Param('id') id: string,
  ) {
    return this.salesService.getOpportunityDetail(this.getContext(user), id);
  }

  /** SEC-A1: workspace comes from the authorized token, never a header. */
  private getContext(user: AuthTokenPayload): AgencyContext {
    return {
      tenantId: user.tenantId,
      workspaceId: user.workspaceId,
      userId: user.sub,
    };
  }
}
