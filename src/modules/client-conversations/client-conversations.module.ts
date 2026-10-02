import { Module, type OnModuleInit } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesModule } from '../../common/files/files.module';
import { AgencyClient } from '../clients/entities/agency-client.entity';
import { AgencyClientCompanyContext } from '../clients/entities/agency-client-company-context.entity';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { AgencyWorkspaceUserEntity } from '../agency/entities/agency-settings.entities';
import { ClientAreaModule } from '../client-area/client-area.module';
import { ClientAreaMembershipEntity } from '../client-area/entities/client-area-membership.entity';
import { PermissionsModule } from '../permissions';
import { AgencyClientConversationsController } from './agency/agency-client-conversations.controller';
import { ClientAreaConversationsPreviewController } from './agency/client-conversations-preview.controller';
import { ClientAreaConversationsController } from './client/client-conversations.controller';
import {
  ClientConversationAttachmentEntity,
  ClientConversationEntity,
  ClientConversationMessageEntity,
  ClientConversationParticipantEntity,
} from './entities';
import { AgencyClientConversationsGateway } from './gateways/agency-client-conversations.gateway';
import { ClientConversationsGateway } from './gateways/client-conversations.gateway';
import { ClientConversationApprovalsRegistry } from './client-conversation-approvals.port';
import { AgencyClientConversationAccessService } from './services/agency-client-conversation-access.service';
import { ClientConversationAttachmentsService } from './services/client-conversation-attachments.service';
import { ClientConversationTimelineService } from './services/client-conversation-timeline.service';
import { ClientConversationsService } from './services/client-conversations.service';
import { ClientConversationNotificationPublisher } from './services/client-conversation-notification.publisher';
import { NotificationsModule } from '../notifications/notifications.module';

const AGENCY_CONNECTION = 'agency';

/**
 * CCOM1 — Client Conversations.
 *
 * One domain, two boundaries. The Client Area controller and the Agency
 * controller both delegate to `ClientConversationsService`, which holds the
 * single access primitive; neither boundary can answer a question about
 * visibility on its own. That is the structural fix for what made the Agency
 * chat wrong — two code paths with two different answers (CCOM0.5 §1).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        ClientConversationEntity,
        ClientConversationParticipantEntity,
        ClientConversationMessageEntity,
        ClientConversationAttachmentEntity,
        // Read-only dependencies: scope validation and actor eligibility.
        AgencyClient,
        AgencyClientCompanyContext,
        ContactEntity,
        ClientAreaMembershipEntity,
        AgencyWorkspaceUserEntity,
      ],
      AGENCY_CONNECTION,
    ),
    JwtModule.register({}),
    FilesModule,
    PermissionsModule,
    ClientAreaModule,
    // NTF-C1 — the Notifications Core, for the message-created publisher. The
    // arrow runs this way only: the core knows nothing of conversations.
    NotificationsModule,
  ],
  controllers: [
    ClientAreaConversationsController,
    AgencyClientConversationsController,
    ClientAreaConversationsPreviewController,
  ],
  providers: [
    ClientConversationsService,
    ClientConversationAttachmentsService,
    AgencyClientConversationAccessService,
    ClientConversationsGateway,
    AgencyClientConversationsGateway,
    // CCOM2 — the cross-source timeline, and the registry it reads the
    // approvals side through. Declared here so it sits in the timeline
    // service's own resolution context; `ClientConversationApprovalsModule`
    // fills it on init (see that module's note on why not a token).
    ClientConversationTimelineService,
    ClientConversationApprovalsRegistry,
    // NTF-C1 §39/§40 — one publisher for both directions of
    // `client_conversation.message.created`.
    ClientConversationNotificationPublisher,
  ],
  exports: [
    ClientConversationsService,
    ClientConversationAttachmentsService,
    ClientConversationTimelineService,
    ClientConversationApprovalsRegistry,
    ClientConversationsGateway,
    AgencyClientConversationsGateway,
  ],
})
export class ClientConversationsModule implements OnModuleInit {
  constructor(
    private readonly conversations: ClientConversationsService,
    private readonly attachments: ClientConversationAttachmentsService,
  ) {}

  /**
   * Wires attachment projection into the conversations service.
   *
   * The attachments service depends on the conversations service to re-prove
   * conversation access — it must not grow its own copy of that check — so a
   * constructor dependency in the other direction would be a cycle. Nest offers
   * `forwardRef`, but that would hide a genuine design fact: the dependency is
   * one-way, and only the *projection* flows back. Registering it here states
   * that once, at the only place that knows both.
   */
  onModuleInit(): void {
    this.conversations.registerAttachmentProjection((messageIds) =>
      this.attachments.forMessages(messageIds),
    );
    this.conversations.registerAttachmentBinder(
      (conversationId, messageId, attachmentIds) =>
        this.attachments.attachToMessage(
          conversationId,
          messageId,
          attachmentIds,
        ),
    );
  }
}
