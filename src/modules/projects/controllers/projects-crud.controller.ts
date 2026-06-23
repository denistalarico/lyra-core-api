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

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  role?: string;
};

function getContextFromHeaders(
  headers: Record<string, string | string[] | undefined>,
): RequestContext {
  return {
    tenantId: String(headers['x-tenant-id'] ?? ''),
    workspaceId: String(headers['x-workspace-id'] ?? ''),
    userId: String(headers['x-user-id'] ?? ''),
    role: String(headers['x-user-role'] ?? headers['x-role'] ?? 'member'),
  };
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/projects')
export class ProjectsCrudController {
  constructor(private readonly projectsCrudService: ProjectsCrudService) {}

  @Get()
  @RequirePermission('agency.projects.project.view.assigned')
  list(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListProjectsQueryDto,
  ) {
    return this.projectsCrudService.list(getContextFromHeaders(headers), query);
  }

  @Get(':id')
  @RequirePermission('agency.projects.project.view.assigned')
  findOne(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.projectsCrudService.findOne(getContextFromHeaders(headers), id);
  }

  @Post()
  @RequirePermission('agency.projects.project.create.department')
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsCrudService.create(getContextFromHeaders(headers), dto);
  }

  @Patch(':id')
  @RequirePermission('agency.projects.project.update.department')
  update(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsCrudService.update(
      getContextFromHeaders(headers),
      id,
      dto,
    );
  }

  @Delete(':id')
  @RequireAnyPermission(
    'agency.projects.project.archive.department',
    'agency.projects.project.archive.own',
  )
  @DangerousAction()
  archive(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.projectsCrudService.archive(getContextFromHeaders(headers), id);
  }

  @Delete(':id/permanent')
  @RequirePermission('agency.projects.project.delete.owner_only')
  @DangerousAction()
  remove(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.projectsCrudService.remove(getContextFromHeaders(headers), id);
  }
}
