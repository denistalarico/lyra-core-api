import { Controller, Post, UseGuards } from '@nestjs/common';
import { ProjectSeedsService } from '../services/project-seeds.service';
import { PermissionsGuard, RequirePermission } from '../../permissions';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/projects')
export class ProjectSeedsController {
  constructor(private readonly projectSeedsService: ProjectSeedsService) {}

  @Post('seed-defaults')
  @RequirePermission('agency.projects.stages.manage.admin')
  seedDefaults(@AuthorizedContext() context: AuthorizedRequestContext) {
    return this.projectSeedsService.seedDefaults(context);
  }
}
