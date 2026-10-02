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
import { ClientConversationCardRegistry } from './client-conversation-card.port';
import { SocialApprovalNotificationPublisher } from './social-approval-notification.publisher';
import {
  SocialApprovalCommentEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStageDecisionEntity,
} from './entities';
import { SocialApprovalsController } from './social-approvals.controller';
import { SocialApprovalsService } from './social-approvals.service';
import { ApprovalSubjectResolver } from './subjects/approval-subject-resolver';

/**
 * The approvals domain and its Agency surface.
 *
 * Deliberately knows nothing about the Client Area: AP3's client routes live
 * in `ClientAreaApprovalsModule`, which imports this module and the Client
 * Area one. Importing `ClientAreaModule` here would make every consumer of
 * the approvals domain (the Planner, and through it Social Organic) depend
 * on the Client Area authentication stack.
 *
 * `SocialApprovalNotificationPublisher` reaches the client email channel
 * through an optional injection, so the client notifier is used when the
 * Client Area surface is wired and simply absent when it is not.
 */
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
    // CCOM2 §7 — declared here so it is inside the publisher's own resolution
    // context; `ClientConversationApprovalsModule` fills it on init. Empty
    // until then, which is how this domain keeps working without the
    // conversation surface.
    ClientConversationCardRegistry,
  ],
  exports: [
    SocialApprovalsService,
    ApprovalClientReviewService,
    ApprovalSubjectResolver,
    SocialApprovalNotificationPublisher,
    ClientConversationCardRegistry,
    TypeOrmModule,
  ],
})
export class SocialApprovalsModule {}
