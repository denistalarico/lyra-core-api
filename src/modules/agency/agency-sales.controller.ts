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
  UpdateAgencySalesItemDto,
  UpdateAgencySalesActivityDto,
  UpdateAgencySalesOpportunityDto,
  UpdateAgencySalesOpportunityItemDto,
} from './dto/agency-sales.dto';
import { AgencySalesService } from './agency-sales.service';

type AgencyContext = {
  tenantId: string;
  workspaceId: string;
  userId?: string;
};

@Controller('agency/sales')
@UseGuards(JwtAuthGuard)
export class AgencySalesController {
  constructor(private readonly salesService: AgencySalesService) {}

  @Get('health')
  health() {
    return this.salesService.health();
  }

  @Get('overview')
  overview(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.salesService.getOverview(this.getContext(user, workspaceId));
  }

  @Post('items')
  createItem(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() dto: CreateAgencySalesItemDto,
  ) {
    return this.salesService.createItem(this.getContext(user, workspaceId), dto);
  }

  @Get('items')
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

  @Post('pipelines')
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
  listPipelines(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.salesService.listPipelines(this.getContext(user, workspaceId));
  }

  @Post('stages')
  createStage(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() dto: CreateAgencySalesStageDto,
  ) {
    return this.salesService.createStage(this.getContext(user, workspaceId), dto);
  }


  @Get('defaults')
  defaults(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.salesService.getDefaults(this.getContext(user, workspaceId));
  }

  @Post('opportunities/quick')
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
  listOpportunities(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId?: string,
  ) {
    return this.salesService.listOpportunities(
      this.getContext(user, workspaceId),
    );
  }





  @Get('opportunities/:id')
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

  @Get('opportunities/:id/activities')
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
