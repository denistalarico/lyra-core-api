import { Body, Controller, Get, Headers, Patch } from '@nestjs/common';
import { UpdateProjectPreferencesDto, UpdateProjectSettingsDto } from '../dto';
import { ProjectSettingsService } from '../services/project-settings.service';

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
export class ProjectSettingsController {
  constructor(private readonly projectSettingsService: ProjectSettingsService) {}

  @Get('settings')
  getSettings(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.projectSettingsService.getSettings(getContextFromHeaders(headers));
  }

  @Patch('settings')
  updateSettings(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: UpdateProjectSettingsDto,
  ) {
    return this.projectSettingsService.updateSettings(getContextFromHeaders(headers), dto);
  }

  @Get('preferences')
  getPreferences(@Headers() headers: Record<string, string | string[] | undefined>) {
    return this.projectSettingsService.getPreferences(getContextFromHeaders(headers));
  }

  @Patch('preferences')
  updatePreferences(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() dto: UpdateProjectPreferencesDto,
  ) {
    return this.projectSettingsService.updatePreferences(getContextFromHeaders(headers), dto);
  }
}
