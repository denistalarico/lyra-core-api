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
} from '@nestjs/common';
import { ActivitiesService } from '../services/activities.service';
import {
  CancelActivityDto,
  CompleteActivityDto,
  CompleteAndScheduleNextActivityDto,
  CreateActivityDto,
  CreateActivityLinkDto,
  ListActivitiesQueryDto,
  UpdateActivityDto,
} from '../dto';
import { ActivityEntityType } from '../enums';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

function getContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): RequestContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
  };
}

@Controller('agency/activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get('types')
  getTypesConfig() {
    return this.activitiesService.getTypesConfig();
  }

  @Get()
  list(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListActivitiesQueryDto,
  ) {
    return this.activitiesService.list(getContextFromHeaders(headers), query);
  }

  @Get('my')
  listMyActivities(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListActivitiesQueryDto,
  ) {
    return this.activitiesService.listMyActivities(
      getContextFromHeaders(headers),
      query,
    );
  }

  @Get('overdue')
  listOverdueActivities(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListActivitiesQueryDto,
  ) {
    return this.activitiesService.listOverdueActivities(
      getContextFromHeaders(headers),
      query,
    );
  }

  @Get('summary')
  getSummary(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.activitiesService.getSummary(getContextFromHeaders(headers));
  }

  @Get('context/:entityType/:entityId')
  listByContext(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('entityType') entityType: ActivityEntityType,
    @Param('entityId') entityId: string,
  ) {
    return this.activitiesService.listByContext(
      getContextFromHeaders(headers),
      entityType,
      entityId,
    );
  }

  @Post()
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateActivityDto,
  ) {
    return this.activitiesService.create(getContextFromHeaders(headers), dto);
  }

  @Get(':id')
  findOne(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.activitiesService.findOne(getContextFromHeaders(headers), id);
  }

  @Patch(':id')
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activitiesService.update(getContextFromHeaders(headers), id, dto);
  }

  @Delete(':id')
  archive(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.activitiesService.archive(getContextFromHeaders(headers), id);
  }

  @Post(':id/complete')
  complete(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: CompleteActivityDto,
  ) {
    return this.activitiesService.complete(getContextFromHeaders(headers), id, dto);
  }

  @Post(':id/complete-and-schedule-next')
  completeAndScheduleNext(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: CompleteAndScheduleNextActivityDto,
  ) {
    return this.activitiesService.completeAndScheduleNext(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Post(':id/cancel')
  cancel(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: CancelActivityDto,
  ) {
    return this.activitiesService.cancel(getContextFromHeaders(headers), id, dto);
  }

  @Post(':id/links')
  createLink(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: CreateActivityLinkDto,
  ) {
    return this.activitiesService.createLink(getContextFromHeaders(headers), id, dto);
  }

  @Delete(':id/links/:linkId')
  deleteLink(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ) {
    return this.activitiesService.deleteLink(
      getContextFromHeaders(headers),
      id,
      linkId,
    );
  }
}
