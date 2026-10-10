import {
  Body,
  Controller,
  Delete,
  Get,
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
import {
  AuthorizedContext,
  type AuthorizedRequestContext,
} from '../../../common/context/authorized-context.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agency/team')
export class TeamLifecycleController {
  constructor(private readonly teamLifecycleService: TeamLifecycleService) {}

  @Get('members/:id/lifecycle/:processType')
  @RequirePermission('agency.team.member.view.department')
  getLifecycle(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('processType') processType: TeamLifecycleProcessType,
  ) {
    return this.teamLifecycleService.getLifecycle(context, id, processType);
  }

  @Post('members/:id/lifecycle/:processType/start')
  @RequirePermission('agency.team.member.update.department')
  startLifecycle(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('processType') processType: TeamLifecycleProcessType,
    @Body() dto: StartTeamMemberLifecycleDto,
  ) {
    return this.teamLifecycleService.startLifecycle(
      context,
      id,
      processType,
      dto,
    );
  }

  @Post('members/:id/lifecycle/:processType/apply-template')
  @RequirePermission('agency.team.member.update.department')
  applyTemplate(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('processType') processType: TeamLifecycleProcessType,
  ) {
    return this.teamLifecycleService.applyTemplate(context, id, processType);
  }

  @Post('members/:id/lifecycle/:processType/complete')
  @RequirePermission('agency.team.member.update.department')
  completeLifecycle(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('processType') processType: TeamLifecycleProcessType,
  ) {
    return this.teamLifecycleService.completeLifecycle(
      context,
      id,
      processType,
    );
  }

  @Post('members/:id/lifecycle/:processType/steps')
  @RequirePermission('agency.team.member.update.department')
  createStep(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('processType') processType: TeamLifecycleProcessType,
    @Body() dto: CreateTeamMemberLifecycleStepDto,
  ) {
    return this.teamLifecycleService.createStep(context, id, processType, dto);
  }

  @Delete('members/:id/lifecycle/steps/:stepId')
  @RequirePermission('agency.team.member.update.department')
  deleteStep(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
  ) {
    return this.teamLifecycleService.deleteStep(context, id, stepId);
  }

  @Patch('members/:id/lifecycle/steps/:stepId')
  @RequirePermission('agency.team.member.update.department')
  updateStep(
    @AuthorizedContext() context: AuthorizedRequestContext,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() dto: UpdateTeamMemberLifecycleStepDto,
  ) {
    return this.teamLifecycleService.updateStep(context, id, stepId, dto);
  }
}
