import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
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
import { AgencyUserSessionEntity } from '../agency/entities/agency-auth.entities';
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
import { InstagramMetaAdapter } from './channels/meta/adapters/instagram-meta.adapter';
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
import { PlatformWhatsAppNotificationModule } from '../notifications/platform-whatsapp/platform-whatsapp-notification.module';
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
import { InboxHandoffWhatsAppNotifier } from './services/inbox-handoff-whatsapp.notifier';
import { InboxAgentRuntimeService } from './services/inbox-agent-runtime.service';
import { InboxAgentRuntimeWorker } from './services/inbox-agent-runtime.worker';
import { InboxRuntimeConfigService } from './runtime/inbox-runtime-config.service';
import { InboxProviderService } from './runtime/inbox-provider.service';
import { InboxProviderBudgetService } from './runtime/inbox-provider-budget.service';
import {
  AgentDecisionPromptBuilder,
  AgentDecisionV1Service,
  BusinessModeActionPlanner,
} from './runtime/agent-decision-v1.service';
import { AudioTranscriptionWorker } from './runtime/audio-transcription.worker';
import { InboxRealtimeEventBusService } from './realtime/inbox-realtime-event-bus.service';
import { InboxOutboxRelayService } from './services/inbox-outbox-relay.service';
import { InboxGateway } from './realtime/inbox.gateway';
import { InboxChannelLifecycleRequestEntity } from './entities/inbox-channel-lifecycle-request.entity';
import { InboxChannelLifecycleService } from './services/inbox-channel-lifecycle.service';
import { InboxMetaOperationEntity } from './entities/inbox-meta-operation.entity';
import { InboxGovernedActionEntity } from './entities/inbox-governed-action.entity';
import { InboxChannelContactIdentityEntity } from './entities/inbox-channel-contact-identity.entity';
import { InboxAutonomyControlEntity } from './entities/inbox-autonomy-control.entity';
import { InboxPilotOutboundPolicyService } from './channels/whatsapp/services/inbox-pilot-outbound-policy.service';
import { InboxMetaOperationLedgerService } from './channels/whatsapp/services/inbox-meta-operation-ledger.service';
import { LeadFlowAgentChannelBindingEntity } from '../leadflow-agents/entities/leadflow-agent-channel-binding.entity';
import { LeadFlowAgentEntity } from '../leadflow-agents/entities/leadflow-agent.entity';
import { AgentActivationPolicyService } from './services/agent-activation-policy.service';
import { ContactRelationshipResolver } from './services/contact-relationship.resolver';
import { LeadFlowAgentsModule } from '../leadflow-agents/leadflow-agents.module';
import { InboxOutboxAdminController } from './inbox-outbox-admin.controller';
import { InboxGovernedAutonomyPolicyService } from './runtime/inbox-governed-autonomy-policy.service';
import { InboxGovernedActionWorker } from './services/inbox-governed-action.worker';
import { InboxAutonomyAdminService } from './services/inbox-autonomy-admin.service';
import { InboxAutonomyAdminController } from './inbox-autonomy-admin.controller';
import { ConversationPlaybookStateService } from './runtime/conversation-playbook-state.service';
import { CrmModule } from '../crm/crm.module';
import { CrmPipelineEntity } from '../crm/entities/crm-pipeline.entity';

@Module({
  imports: [
    JwtModule.register({}),
    PermissionsModule,
    NotificationsModule,
    PlatformWhatsAppNotificationModule,
    FilesModule,
    LeadFlowAgentsModule,
    CrmModule,
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
        AgencyUserSessionEntity,
        InboxWebhookLogEntity,
        InboxChannelConnectionSessionEntity,
        InboxMediaAssetEntity,
        InboxMediaDerivativeEntity,
        InboxProcessingBatchEntity,
        InboxAgentDecisionEntity,
        InboxDomainOutboxEntity,
        InboxChannelLifecycleRequestEntity,
        InboxMetaOperationEntity,
        InboxGovernedActionEntity,
        InboxChannelContactIdentityEntity,
        InboxAutonomyControlEntity,
        LeadFlowAgentChannelBindingEntity,
        LeadFlowAgentEntity,
        CrmPipelineEntity,
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
    InboxOutboxAdminController,
    InboxAutonomyAdminController,
  ],
  providers: [
    InboxService,
    InboxSettingsService,
    SettingsCryptoService,
    InboundMessageIngestionService,
    InboxNotificationPublisher,
    MetaChannelResolverService,
    WhatsAppMetaAdapter,
    InstagramMetaAdapter,
    WebhookLogService,
    MessageStatusSyncService,
    WhatsAppOutboundService,
    WhatsAppEmbeddedSignupService,
    MetaGraphService,
    WhatsAppChannelHealthService,
    InboxMediaService,
    MetaMediaIngestionWorker,
    ConversationOwnershipService,
    InboxHandoffWhatsAppNotifier,
    InboxAgentRuntimeService,
    InboxAgentRuntimeWorker,
    InboxRuntimeConfigService,
    InboxProviderService,
    InboxProviderBudgetService,
    AgentDecisionPromptBuilder,
    AgentDecisionV1Service,
    BusinessModeActionPlanner,
    AudioTranscriptionWorker,
    InboxRealtimeEventBusService,
    InboxOutboxRelayService,
    InboxGateway,
    InboxChannelLifecycleService,
    AgentActivationPolicyService,
    ContactRelationshipResolver,
    InboxPilotOutboundPolicyService,
    InboxMetaOperationLedgerService,
    InboxGovernedAutonomyPolicyService,
    InboxGovernedActionWorker,
    InboxAutonomyAdminService,
    ConversationPlaybookStateService,
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
    ConversationOwnershipService,
  ],
})
export class InboxModule {}
