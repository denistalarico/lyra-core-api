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
} from '../../../common/context/authorized-context.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/projects')
export class ProjectsCrudController {
  constructor(private readonly projectsCrudService: ProjectsCrudService) {}

  @Get()
  @RequirePermission('agency.projects.project.view.assigned')
  list(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Query() query: ListProjectsQueryDto,
  ) {
    return this.projectsCrudService.list(context, query);
  }

  @Get(':id')
  @RequirePermission('agency.projects.project.view.assigned')
  findOne(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
  ) {
    return this.projectsCrudService.findOne(context, id);
  }

  @Post()
  @RequirePermission('agency.projects.project.create.department')
  create(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsCrudService.create(context, dto);
  }

  @Patch(':id')
  @RequirePermission('agency.projects.project.update.department')
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
  @DangerousAction()
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
