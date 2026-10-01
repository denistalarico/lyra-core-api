import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaAssetsModule } from '../../../common/media-assets/media-assets.module';
import { AGENCY_IDENTITY_CREDENTIALS } from '../../agency/agency-identity-credentials.token';
import { AgencyUserProfileEntity } from '../../agency/entities/agency-settings.entities';
import { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import { ClientAreaModule } from '../../client-area/client-area.module';
import { ClientAreaMembershipEntity } from '../../client-area/entities/client-area-membership.entity';
import { EmailModule } from '../../email/email.module';
import { PermissionsModule } from '../../permissions';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
} from '../../social-creative-studio/entities';
import {
  SocialContentItemEntity,
  SocialContentRevisionEntity,
  SocialPlanEntity,
} from '../../social-planner/entities';
import {
  SocialApprovalCommentEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStageDecisionEntity,
} from '../entities';
import { ApprovalClientReviewService } from '../approval-client-review.service';
import { CLIENT_APPROVAL_NOTIFIER } from '../client-approval-notifier.port';
import { SocialApprovalsModule } from '../social-approvals.module';
import { ApprovalSubjectResolver } from '../subjects/approval-subject-resolver';
import { ClientApprovalMediaService } from './client-approval-media.service';
import {
  ClientApprovalNotificationService,
  CLIENT_APPROVAL_EMAIL_TRANSPORT,
} from './client-approval-notification.service';
import { ClientAreaApprovalNotificationEntity } from './client-approval-notification.entity';
import { ClientAreaApprovalsPreviewController } from './client-approvals-preview.controller';
import { ClientAreaApprovalsController } from './client-approvals.controller';
import { ClientApprovalsService } from './client-approvals.service';

/**
 * AP3 — the Client Area approvals surface, wired separately from
 * `SocialApprovalsModule`.
 *
 * WHY IT IS NOT PART OF THE APPROVALS MODULE
 * ------------------------------------------
 * The dependency has to point one way: Client Area → approvals domain. If
 * `SocialApprovalsModule` imported `ClientAreaModule`, then everything that
 * already depends on the approvals domain — `SocialPlannerModule`, and
 * through it `SocialOrganicModule` — would transitively depend on the whole
 * Client Area authentication stack, including the credential service and its
 * ESM `otplib` dependency. Modules that have nothing to do with the Client
 * Area would fail to load in tests because of it.
 *
 * Keeping the surface in its own module preserves the direction of the arrow:
 * this module imports both sides, and neither side knows about it.
 */
@Module({
  imports: [
    SocialApprovalsModule,
    ClientAreaModule,
    // The Agency preview controller sits behind the Agency permission stack.
    PermissionsModule,
    // Re-exports FilesModule, which streams the private media bytes.
    MediaAssetsModule,
    EmailModule,
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
        ClientAreaApprovalNotificationEntity,
        ClientAreaMembershipEntity,
        AgencyUserProfileEntity,
        AgencyUserSecuritySettingsEntity,
      ],
      'agency',
    ),
  ],
  controllers: [
    ClientAreaApprovalsController,
    ClientAreaApprovalsPreviewController,
  ],
  providers: [
    ClientApprovalsService,
    ClientApprovalMediaService,
    ClientApprovalNotificationService,
    ApprovalSubjectResolver,
    ApprovalClientReviewService,
    {
      provide: CLIENT_APPROVAL_EMAIL_TRANSPORT,
      useExisting: AGENCY_IDENTITY_CREDENTIALS,
    },
    // Binds the domain's notifier port to the real email channel. Until this
    // module is wired, the publisher's optional injection is simply empty and
    // only the Agency audience is notified.
    {
      provide: CLIENT_APPROVAL_NOTIFIER,
      useExisting: ClientApprovalNotificationService,
    },
  ],
  exports: [ClientApprovalsService, ClientApprovalNotificationService],
})
export class ClientAreaApprovalsModule {}
