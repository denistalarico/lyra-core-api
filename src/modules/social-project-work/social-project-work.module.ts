import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions';
import { ProjectsModule } from '../projects/projects.module';
import { SocialApprovalsModule } from '../social-approvals/social-approvals.module';
import { SocialCreativeStudioModule } from '../social-creative-studio/social-creative-studio.module';
import { SocialPlannerApprovalsModule } from '../social-planner-approvals/social-planner-approvals.module';
import { SocialPlannerModule } from '../social-planner/social-planner.module';
import {
  SocialPlanWorkController,
  SocialSubtaskApprovalsController,
} from './social-project-work.controller';
import { SocialPlanWorkService } from './social-plan-work.service';
import { SocialSubtaskApprovalsService } from './social-subtask-approvals.service';
import { SocialWorkGateService } from './social-work-gate.service';
import { SocialWorkStatusService } from './social-work-status.service';

/**
 * AR4 — join module (D-30) between Planner, Approvals and Projects. Neither
 * side knows it exists: it fills `SocialApprovalTransitionRegistry` and
 * `SocialPlanContentChangeRegistry` on init.
 */
@Module({
  imports: [
    PermissionsModule,
    ProjectsModule,
    SocialApprovalsModule,
    SocialPlannerModule,
    SocialCreativeStudioModule,
    SocialPlannerApprovalsModule,
  ],
  controllers: [SocialPlanWorkController, SocialSubtaskApprovalsController],
  providers: [
    SocialWorkGateService,
    SocialWorkStatusService,
    SocialPlanWorkService,
    SocialSubtaskApprovalsService,
  ],
})
export class SocialProjectWorkModule {}
