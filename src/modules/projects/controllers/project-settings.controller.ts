import {
  Body,
  Controller,
  Get,
  Headers,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UpdateProjectPreferencesDto, UpdateProjectSettingsDto } from '../dto';
import { ProjectSettingsService } from '../services/project-settings.service';
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
export class ProjectSettingsController {
  constructor(
    private readonly projectSettingsService: ProjectSettingsService,
  ) {}

  @Get('settings')
  @RequirePermission('agency.projects.stages.manage.admin')
  getSettings(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.projectSettingsService.getSettings(
      getContextFromHeaders(headers),
    );
  }

  @Patch('settings')
  @RequirePermission('agency.projects.stages.manage.admin')
  updateSettings(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: UpdateProjectSettingsDto,
  ) {
    return this.projectSettingsService.updateSettings(
      getContextFromHeaders(headers),
      dto,
    );
  }

  @Get('preferences')
  @RequirePermission('agency.projects.project.view.assigned')
  getPreferences(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.projectSettingsService.getPreferences(
      getContextFromHeaders(headers),
    );
  }

  @Patch('preferences')
  @RequirePermission('agency.projects.project.view.assigned')
  updatePreferences(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: UpdateProjectPreferencesDto,
  ) {
    return this.projectSettingsService.updatePreferences(
      getContextFromHeaders(headers),
      dto,
    );
  }
}
