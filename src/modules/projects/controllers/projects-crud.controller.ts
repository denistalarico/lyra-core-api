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
import { ProjectsCrudService } from '../services/projects-crud.service';
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  UpdateProjectDto,
} from '../dto';

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

@Controller('agency/projects')
export class ProjectsCrudController {
  constructor(private readonly projectsCrudService: ProjectsCrudService) {}

  @Get()
  list(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Query() query: ListProjectsQueryDto,
  ) {
    return this.projectsCrudService.list(getContextFromHeaders(headers), query);
  }

  @Get(':id')
  findOne(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.projectsCrudService.findOne(getContextFromHeaders(headers), id);
  }

  @Post()
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsCrudService.create(getContextFromHeaders(headers), dto);
  }

  @Patch(':id')
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
  archive(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
  ) {
    return this.projectsCrudService.archive(getContextFromHeaders(headers), id);
  }
}
