import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UpdateProjectPreferencesDto, UpdateProjectSettingsDto } from '../dto';
import { ProjectSettingsService } from '../services/project-settings.service';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/projects')
export class ProjectSettingsController {
  constructor(
    private readonly projectSettingsService: ProjectSettingsService,
  ) {}

  @Get('settings')
  @RequirePermission('agency.projects.stages.manage.admin')
  getSettings(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.projectSettingsService.getSettings(context);
  }

  @Patch('settings')
  @RequirePermission('agency.projects.stages.manage.admin')
  updateSettings(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: UpdateProjectSettingsDto,
  ) {
    return this.projectSettingsService.updateSettings(context, dto);
  }

  @Get('preferences')
  @RequirePermission('agency.projects.project.view.assigned')
  getPreferences(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.projectSettingsService.getPreferences(context);
  }

  @Patch('preferences')
  @RequirePermission('agency.projects.project.view.assigned')
  updatePreferences(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Body() dto: UpdateProjectPreferencesDto,
  ) {
    return this.projectSettingsService.updatePreferences(context, dto);
  }
}
