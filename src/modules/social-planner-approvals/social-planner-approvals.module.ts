import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions';
import { SocialApprovalsModule } from '../social-approvals/social-approvals.module';
import { SocialCreativeStudioModule } from '../social-creative-studio/social-creative-studio.module';
import { SocialPlannerModule } from '../social-planner/social-planner.module';
import { SocialPlannerApprovalsController } from './social-planner-approvals.controller';
import { SocialPlannerApprovalsService } from './social-planner-approvals.service';

/**
 * AR3 — join module (D-30). The Studio imports the Planner, so the Planner
 * can never reach back for the Studio; this module imports both.
 */
@Module({
  imports: [
    PermissionsModule,
    SocialApprovalsModule,
    SocialPlannerModule,
    SocialCreativeStudioModule,
  ],
  controllers: [SocialPlannerApprovalsController],
  providers: [SocialPlannerApprovalsService],
})
export class SocialPlannerApprovalsModule {}
