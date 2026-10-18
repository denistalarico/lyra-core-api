import { UseInterceptors } from '@nestjs/common';
import { ClientAreaExposed } from '../../client-area/client-area.decorators';
import { ProjectsClientAreaInterceptor } from '../client-area/projects-client-area.interceptor';
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
import { ProjectsCrudService } from '../services/projects-crud.service';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  UpdateProjectDto,
} from '../dto';
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
@Controller('agency/projects')
export class ProjectsCrudController {
  constructor(private readonly projectsCrudService: ProjectsCrudService) {}

  @Get()
  @RequirePermission('agency.projects.project.view.assigned')
  @ClientAreaExposed('agency_projects')
  list(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query() query: ListProjectsQueryDto,
  ) {
    return this.projectsCrudService.list(context, query);
  }

  @Get(':id')
  @RequirePermission('agency.projects.project.view.assigned')
  @ClientAreaExposed('agency_projects')
  findOne(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.projectsCrudService.findOne(context, id);
  }

  @Post()
  @RequirePermission('agency.projects.project.create.department')
  @ClientAreaExposed('agency_projects')
  create(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsCrudService.create(context, dto);
  }

  @Patch(':id')
  @RequirePermission('agency.projects.project.update.department')
  @ClientAreaExposed('agency_projects')
  update(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsCrudService.update(context, id, dto);
  }

  @Delete(':id')
  @RequireAnyPermission(
    'agency.projects.project.archive.department',
    'agency.projects.project.archive.own',
  )
  // CA9: reclassified with explicit user authorization; Agency permissions stay unchanged.
  @ClientAreaExposed('agency_projects')
  archive(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.projectsCrudService.archive(context, id);
  }

  @Delete(':id/permanent')
  @RequirePermission('agency.projects.project.delete.owner_only')
  @DangerousAction()
  remove(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.projectsCrudService.remove(context, id);
  }
}
