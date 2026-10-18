import { UseInterceptors } from '@nestjs/common';
import { ClientAreaExposed } from '../../client-area/client-area.decorators';
import { ProjectsClientAreaInterceptor } from '../client-area/projects-client-area.interceptor';
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
} from '../client-area/projects-client-area.context';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ProjectsClientAreaInterceptor)
@Controller('agency/projects/:projectId/events')
export class ProjectEventsController {
  constructor(private readonly projectEventsService: ProjectEventsService) {}

  @Get()
  @RequirePermission('agency.projects.project.view.assigned')
  @ClientAreaExposed('agency_projects')
  list(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('projectId') projectId: string,
  ) {
    return this.projectEventsService.list(context, projectId);
  }

  @Post()
  @RequirePermission('agency.projects.project.update.department')
  @ClientAreaExposed('agency_projects')
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
