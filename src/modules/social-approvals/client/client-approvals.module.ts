import { Module, type OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaAssetsModule } from '../../../common/media-assets/media-assets.module';
import { AgencyUserProfileEntity } from '../../agency/entities/agency-settings.entities';
import { AgencyUserSecuritySettingsEntity } from '../../agency/entities/agency-auth.entities';
import { ClientAreaModule } from '../../client-area/client-area.module';
import { ClientAreaMembershipEntity } from '../../client-area/entities/client-area-membership.entity';
import { EmailModule } from '../../email/email.module';
import { NotificationsModule } from '../../notifications/notifications.module';
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
import { ClientApprovalNotifierRegistry } from '../client-approval-notifier.port';
import { SocialApprovalsModule } from '../social-approvals.module';
import { ApprovalSubjectResolver } from '../subjects/approval-subject-resolver';
import { ClientApprovalMediaService } from './client-approval-media.service';
import { ClientApprovalNotificationService } from './client-approval-notification.service';
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
    /**
     * NTF-C1 §3/§10 — this module no longer sends mail: the notifier publishes
     * into the Notifications Core, which owns the email channel and records it
     * in `notification_deliveries` (§50).
     *
     * Imported explicitly, and NOT relied on through `SocialApprovalsModule`,
     * because a module's exports are not transitive: `SocialApprovalsModule`
     * imports `NotificationsModule` for its own publisher, which does not put
     * `NotificationEventProcessorService` in *this* module's resolution
     * context. Leaving it out failed at boot in the CCOM2 PostgreSQL matrix —
     * loudly, which is the failure mode this codebase prefers (CCOM2 §24.2).
     */
    NotificationsModule,
    /**
     * `ClientAreaApprovalNotificationEntity` stays registered on purpose: the
     * AP3 ledger is no longer written but its rows are history and must remain
     * readable (§49).
     */
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
  ],
  exports: [ClientApprovalsService, ClientApprovalNotificationService],
})
export class ClientAreaApprovalsModule implements OnModuleInit {
  /**
   * NTF-C1 §48 — the handoff that AP3's injection token could not perform.
   *
   * This module used to bind `CLIENT_APPROVAL_NOTIFIER` with `provide:`, which
   * put it in *this* module's resolution context and not in
   * `SocialApprovalNotificationPublisher`'s — so the publisher's
   * `@Optional() @Inject()` resolved to `undefined` and every client approval
   * notification was silently dropped. The registry is declared by
   * `SocialApprovalsModule` (always resolvable there) and filled here, which
   * is the same shape CCOM2 proved correct for the conversation card.
   */
  constructor(
    private readonly registry: ClientApprovalNotifierRegistry,
    private readonly notifier: ClientApprovalNotificationService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.notifier);
  }
}
