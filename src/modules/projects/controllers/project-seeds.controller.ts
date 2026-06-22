import { Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { ProjectSeedsService } from '../services/project-seeds.service';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

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

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/projects')
export class ProjectSeedsController {
  constructor(private readonly projectSeedsService: ProjectSeedsService) {}

  @Post('seed-defaults')
  @RequirePermission('agency.projects.stages.manage.admin')
  seedDefaults(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.projectSeedsService.seedDefaults(
      getContextFromHeaders(headers),
    );
  }
}
