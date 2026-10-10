import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CreateProjectEventDto } from '../dto';
import { ProjectEventsService } from '../services/project-events.service';
import {
  DangerousAction,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
} from '../../permissions';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/projects/:projectId/events')
export class ProjectEventsController {
  constructor(private readonly projectEventsService: ProjectEventsService) {}

  @Get()
  @RequirePermission('agency.projects.project.view.assigned')
  list(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('projectId') projectId: string,
  ) {
    return this.projectEventsService.list(context, projectId);
  }

  @Post()
  @RequirePermission('agency.projects.project.update.department')
  create(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectEventDto,
  ) {
    return this.projectEventsService.create(context, projectId, dto);
  }

  @Delete()
  @RequireAnyPermission(
    'agency.projects.project.archive.department',
    'agency.projects.project.archive.own',
  )
  @DangerousAction()
  clearAll(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('projectId') projectId: string,
  ) {
    return this.projectEventsService.clearAll(context, projectId);
  }

  @Delete(':eventId')
  @RequireAnyPermission(
    'agency.projects.project.archive.department',
    'agency.projects.project.archive.own',
  )
  @DangerousAction()
  delete(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('projectId') projectId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.projectEventsService.delete(context, projectId, eventId);
  }
}
