import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
} from '../social-creative-studio/entities';
import {
  SocialContentItemEntity,
  SocialContentRevisionEntity,
  SocialPlanEntity,
} from '../social-planner/entities';
import { ApprovalClientReviewService } from './approval-client-review.service';
import { SocialApprovalNotificationPublisher } from './social-approval-notification.publisher';
import {
  SocialApprovalCommentEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStageDecisionEntity,
} from './entities';
import { SocialApprovalsController } from './social-approvals.controller';
import { SocialApprovalsService } from './social-approvals.service';
import { ApprovalSubjectResolver } from './subjects/approval-subject-resolver';
@Module({
  imports: [
    PermissionsModule,
    NotificationsModule,
    TypeOrmModule.forFeature(
      [
        SocialApprovalRequestEntity,
        SocialApprovalCommentEntity,
        SocialApprovalStageDecisionEntity,
        CreativeAssetEntity,
        CreativeAssetVersionEntity,
        SocialPlanEntity,
        SocialContentItemEntity,
        SocialContentRevisionEntity,
      ],
      'agency',
    ),
  ],
  controllers: [SocialApprovalsController],
  providers: [
    SocialApprovalsService,
    ApprovalSubjectResolver,
    SocialApprovalNotificationPublisher,
    ApprovalClientReviewService,
  ],
  exports: [SocialApprovalsService, ApprovalClientReviewService],
})
export class SocialApprovalsModule {}
