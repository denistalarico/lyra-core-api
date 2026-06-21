import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TeamLifecycleService } from '../services/team-lifecycle.service';
import {
  CreateTeamMemberLifecycleStepDto,
  StartTeamMemberLifecycleDto,
  UpdateTeamMemberLifecycleStepDto,
} from '../dto';
import { TeamLifecycleProcessType } from '../enums';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../../permissions';

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
@Controller('agency/team')
export class TeamLifecycleController {
  constructor(private readonly teamLifecycleService: TeamLifecycleService) {}

  @Get('members/:id/lifecycle/:processType')
  @RequirePermission('agency.team.member.view.department')
  getLifecycle(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('processType') processType: TeamLifecycleProcessType,
  ) {
    return this.teamLifecycleService.getLifecycle(
      getContextFromHeaders(headers),
      id,
      processType,
    );
  }

  @Post('members/:id/lifecycle/:processType/start')
  @RequirePermission('agency.team.member.update.department')
  startLifecycle(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('processType') processType: TeamLifecycleProcessType,
    @Body() dto: StartTeamMemberLifecycleDto,
  ) {
    return this.teamLifecycleService.startLifecycle(
      getContextFromHeaders(headers),
      id,
      processType,
      dto,
    );
  }

  @Post('members/:id/lifecycle/:processType/apply-template')
  @RequirePermission('agency.team.member.update.department')
  applyTemplate(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('processType') processType: TeamLifecycleProcessType,
  ) {
    return this.teamLifecycleService.applyTemplate(
      getContextFromHeaders(headers),
      id,
      processType,
    );
  }

  @Post('members/:id/lifecycle/:processType/complete')
  @RequirePermission('agency.team.member.update.department')
  completeLifecycle(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('processType') processType: TeamLifecycleProcessType,
  ) {
    return this.teamLifecycleService.completeLifecycle(
      getContextFromHeaders(headers),
      id,
      processType,
    );
  }

  @Post('members/:id/lifecycle/:processType/steps')
  @RequirePermission('agency.team.member.update.department')
  createStep(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('processType') processType: TeamLifecycleProcessType,
    @Body() dto: CreateTeamMemberLifecycleStepDto,
  ) {
    return this.teamLifecycleService.createStep(
      getContextFromHeaders(headers),
      id,
      processType,
      dto,
    );
  }

  @Delete('members/:id/lifecycle/steps/:stepId')
  @RequirePermission('agency.team.member.update.department')
  deleteStep(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
  ) {
    return this.teamLifecycleService.deleteStep(
      getContextFromHeaders(headers),
      id,
      stepId,
    );
  }

  @Patch('members/:id/lifecycle/steps/:stepId')
  @RequirePermission('agency.team.member.update.department')
  updateStep(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() dto: UpdateTeamMemberLifecycleStepDto,
  ) {
    return this.teamLifecycleService.updateStep(
      getContextFromHeaders(headers),
      id,
      stepId,
      dto,
    );
  }
}
