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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../permissions';
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
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

// SEC-A1: this controller had no guard at all — any anonymous request with a
// tenant/workspace id in headers read and wrote that tenant's activities.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  @Get('types')
  getTypesConfig() {
    return this.activitiesService.getTypesConfig();
  }

  @Get()
  list(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query() query: ListActivitiesQueryDto,
  ) {
    return this.activitiesService.list(context, query);
  }

  @Get('my')
  listMyActivities(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query() query: ListActivitiesQueryDto,
  ) {
    return this.activitiesService.listMyActivities(context, query);
  }

  @Get('overdue')
  listOverdueActivities(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query() query: ListActivitiesQueryDto,
  ) {
    return this.activitiesService.listOverdueActivities(context, query);
  }

  @Get('summary')
  getSummary(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.activitiesService.getSummary(context);
  }

  @Get('context/:entityType/:entityId')
  listByContext(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('entityType') entityType: ActivityEntityType,
    @Param('entityId') entityId: string,
  ) {
    return this.activitiesService.listByContext(context, entityType, entityId);
  }

  @Post()
  create(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateActivityDto,
  ) {
    return this.activitiesService.create(context, dto);
  }

  @Get(':id')
  findOne(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.activitiesService.findOne(context, id);
  }

  @Patch(':id')
  update(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateActivityDto,
  ) {
    return this.activitiesService.update(context, id, dto);
  }

  @Delete(':id')
  remove(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.activitiesService.remove(context, id);
  }

  @Post(':id/archive')
  archive(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.activitiesService.archive(context, id);
  }

  @Post(':id/complete')
  complete(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: CompleteActivityDto,
  ) {
    return this.activitiesService.complete(context, id, dto);
  }

  @Post(':id/complete-and-schedule-next')
  completeAndScheduleNext(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: CompleteAndScheduleNextActivityDto,
  ) {
    return this.activitiesService.completeAndScheduleNext(context, id, dto);
  }

  @Post(':id/cancel')
  cancel(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: CancelActivityDto,
  ) {
    return this.activitiesService.cancel(context, id, dto);
  }

  @Post(':id/links')
  createLink(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: CreateActivityLinkDto,
  ) {
    return this.activitiesService.createLink(context, id, dto);
  }

  @Delete(':id/links/:linkId')
  deleteLink(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ) {
    return this.activitiesService.deleteLink(context, id, linkId);
  }
}
