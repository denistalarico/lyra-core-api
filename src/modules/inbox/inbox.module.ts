import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InboxChannelEntity } from './entities/inbox-channel.entity';
import { InboxConversationEntity } from './entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from './entities/inbox-conversation-event.entity';
import { InboxConversationParticipantEntity } from './entities/inbox-conversation-participant.entity';
import { InboxMessageEntity } from './entities/inbox-message.entity';
import { InboxSettingsEntity } from './entities/inbox-settings.entity';
import { WorkspaceUserEntity } from '../settings/entities/workspace-user.entity';
import { UserProfileEntity } from '../settings/entities/user-profile.entity';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InboxChannelEntity,
      InboxConversationEntity,
      InboxMessageEntity,
      InboxSettingsEntity,
      InboxConversationParticipantEntity,
      InboxConversationEventEntity,
      WorkspaceUserEntity,
      UserProfileEntity,
      InboxWebhookLogEntity,
      InboxChannelConnectionSessionEntity,
    ]),
  ],
  controllers: [
    InboxController,
    InboxSettingsController,
    InboxChannelsController,
    MetaWebhookController,
    WhatsAppOutboundController,
    WhatsAppEmbeddedSignupController,
    WhatsAppChannelHealthController,
  ],
  providers: [
    InboxService,
    InboxSettingsService,
    SettingsCryptoService,
    InboundMessageIngestionService,
    MetaChannelResolverService,
    WhatsAppMetaAdapter,
    WebhookLogService,
    MessageStatusSyncService,
    WhatsAppOutboundService,
    WhatsAppEmbeddedSignupService,
    MetaGraphService,
    WhatsAppChannelHealthService,
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
