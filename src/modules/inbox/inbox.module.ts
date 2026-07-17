import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InboxChannelEntity } from './entities/inbox-channel.entity';
import { InboxConversationEntity } from './entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from './entities/inbox-conversation-event.entity';
import { InboxConversationParticipantEntity } from './entities/inbox-conversation-participant.entity';
import { InboxMessageEntity } from './entities/inbox-message.entity';
import { InboxSettingsEntity } from './entities/inbox-settings.entity';
import {
  AgencyWorkspaceUserEntity,
  AgencyUserProfileEntity,
} from '../agency/entities/agency-settings.entities';
import { InboxController } from './inbox.controller';
import { InboxSettingsController } from './inbox-settings.controller';
import { InboxService } from './inbox.service';
import { InboxSettingsService } from './inbox-settings.service';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { InboundMessageIngestionService } from './channels/services/inbound-message-ingestion.service';
import { InboxChannelsController } from './channels/inbox-channels.controller';
import { MetaWebhookController } from './channels/meta/meta-webhook.controller';
import { MetaChannelResolverService } from './channels/meta/services/meta-channel-resolver.service';
import { WhatsAppMetaAdapter } from './channels/meta/adapters/whatsapp-meta.adapter';
import { InboxWebhookLogEntity } from './entities/inbox-webhook-log.entity';
import { WebhookLogService } from './channels/services/webhook-log.service';
import { MessageStatusSyncService } from './channels/services/message-status-sync.service';
import { WhatsAppOutboundController } from './channels/whatsapp/whatsapp-outbound.controller';
import { WhatsAppOutboundService } from './channels/whatsapp/services/whatsapp-outbound.service';
import { InboxChannelConnectionSessionEntity } from './entities/inbox-channel-connection-session.entity';
import { WhatsAppEmbeddedSignupController } from './channels/whatsapp/embedded-signup/whatsapp-embedded-signup.controller';
import { WhatsAppEmbeddedSignupService } from './channels/whatsapp/embedded-signup/whatsapp-embedded-signup.service';
import { MetaGraphService } from './channels/meta/services/meta-graph.service';
import { WhatsAppChannelHealthController } from './channels/whatsapp/whatsapp-channel-health.controller';
import { WhatsAppChannelHealthService } from './channels/whatsapp/services/whatsapp-channel-health.service';
import { PermissionsModule } from '../permissions';
import { NotificationsModule } from '../notifications';
import { FilesModule } from '../../common/files/files.module';
import { InboxNotificationPublisher } from './services/inbox-notification.publisher';
import { InboxMediaAssetEntity } from './entities/inbox-media-asset.entity';
import { InboxMediaDerivativeEntity } from './entities/inbox-media-derivative.entity';
import { InboxProcessingBatchEntity } from './entities/inbox-processing-batch.entity';
import { InboxAgentDecisionEntity } from './entities/inbox-agent-decision.entity';
import { InboxDomainOutboxEntity } from './entities/inbox-domain-outbox.entity';
import { InboxMediaController } from './inbox-media.controller';
import { InboxMediaService } from './services/inbox-media.service';
import { MetaMediaIngestionWorker } from './channels/meta/services/meta-media-ingestion.worker';
import { ConversationOwnershipService } from './services/conversation-ownership.service';
import { InboxAgentRuntimeService } from './services/inbox-agent-runtime.service';
import { InboxAgentRuntimeWorker } from './services/inbox-agent-runtime.worker';

@Module({
  imports: [
    PermissionsModule,
    NotificationsModule,
    FilesModule,
    TypeOrmModule.forFeature(
      [
        InboxChannelEntity,
        InboxConversationEntity,
        InboxMessageEntity,
        InboxSettingsEntity,
        InboxConversationParticipantEntity,
        InboxConversationEventEntity,
        AgencyWorkspaceUserEntity,
        AgencyUserProfileEntity,
        InboxWebhookLogEntity,
        InboxChannelConnectionSessionEntity,
        InboxMediaAssetEntity,
        InboxMediaDerivativeEntity,
        InboxProcessingBatchEntity,
        InboxAgentDecisionEntity,
        InboxDomainOutboxEntity,
      ],
      'agency',
    ),
  ],
  controllers: [
    InboxController,
    InboxSettingsController,
    InboxChannelsController,
    MetaWebhookController,
    WhatsAppOutboundController,
    WhatsAppEmbeddedSignupController,
    WhatsAppChannelHealthController,
    InboxMediaController,
  ],
  providers: [
    InboxService,
    InboxSettingsService,
    SettingsCryptoService,
    InboundMessageIngestionService,
    InboxNotificationPublisher,
    MetaChannelResolverService,
    WhatsAppMetaAdapter,
    WebhookLogService,
    MessageStatusSyncService,
    WhatsAppOutboundService,
    WhatsAppEmbeddedSignupService,
    MetaGraphService,
    WhatsAppChannelHealthService,
    InboxMediaService,
    MetaMediaIngestionWorker,
    ConversationOwnershipService,
    InboxAgentRuntimeService,
    InboxAgentRuntimeWorker,
  ],
  exports: [
    InboxService,
    InboxSettingsService,
    InboundMessageIngestionService,
    WebhookLogService,
    MessageStatusSyncService,
    WhatsAppOutboundService,
    WhatsAppEmbeddedSignupService,
    MetaGraphService,
    WhatsAppChannelHealthService,
  ],
})
export class InboxModule {}
