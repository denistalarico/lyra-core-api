import { Body, Controller, Delete, Get, Headers, Param, Post } from '@nestjs/common';
import { CreateProjectEventDto } from '../dto';
import { ProjectEventsService } from '../services/project-events.service';

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

@Controller('agency/projects/:projectId/events')
export class ProjectEventsController {
  constructor(private readonly projectEventsService: ProjectEventsService) {}

  @Get()
  list(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('projectId') projectId: string,
  ) {
    return this.projectEventsService.list(getContextFromHeaders(headers), projectId);
  }

  @Post()
  create(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectEventDto,
  ) {
    return this.projectEventsService.create(getContextFromHeaders(headers), projectId, dto);
  }

  @Delete()
  clearAll(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('projectId') projectId: string,
  ) {
    return this.projectEventsService.clearAll(getContextFromHeaders(headers), projectId);
  }

  @Delete(':eventId')
  delete(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('projectId') projectId: string,
    @Param('eventId') eventId: string,
  ) {
    return this.projectEventsService.delete(getContextFromHeaders(headers), projectId, eventId);
  }
}
