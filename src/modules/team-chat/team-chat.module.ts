import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AgencyChatAttachment,
  AgencyChatChannel,
  AgencyChatChannelMember,
  AgencyChatMessage,
  AgencyChatMessageRead,
  AgencyChatUserSettings,
  AgencyMeetingAiSummary,
  AgencyMeetingEvent,
  AgencyMeetingParticipant,
  AgencyMeetingRoom,
} from './entities';
import { TeamChatController } from './controllers/team-chat.controller';
import { TeamChatChannelsService } from './services/team-chat-channels.service';
import { TeamChatMessagesService } from './services/team-chat-messages.service';
import { TeamChatMeetingsService } from './services/team-chat-meetings.service';
import { TeamChatGateway } from './gateways/team-chat.gateway';
import { TeamChatAttachmentsService } from './services/team-chat-attachments.service';
import { TeamChatLiveKitProviderService } from './services/team-chat-livekit-provider.service';
import { TeamChatUserSettingsService } from './services/team-chat-user-settings.service';
import { TeamChatAttachmentsController } from './controllers/team-chat-attachments.controller';
import { TeamChatMeetingsController } from './controllers/team-chat-meetings.controller';
import { FilesModule } from '../../common/files/files.module';
import { NotificationsModule } from '../notifications';
import { PermissionsModule } from '../permissions';
import { TeamChatNotificationPublisher } from './services/team-chat-notification.publisher';
import { TeamChatCardPostService } from './services/team-chat-card-post.service';
import { WorkspaceUserEntity } from '../settings/entities/workspace-user.entity';
import { AgencyUserProfileEntity } from '../agency/entities/agency-settings.entities';
import { AgencyMeetingAiSettings } from './entities/agency-meeting-ai-settings.entity';
import { FinanceAccount } from '../finance/entities/finance-account.entity';
import { FinanceCostCenter } from '../finance/entities/finance-cost-center.entity';
import { DocumentLayoutsModule } from '../document-layouts/document-layouts.module';
import { TeamChatMeetingAiController } from './controllers/team-chat-meeting-ai.controller';
import { TeamChatMeetingAiService } from './services/team-chat-meeting-ai.service';
import { TeamChatMeetingAiProviderService } from './services/team-chat-meeting-ai-provider.service';
import { TeamChatMeetingAiWorkerService } from './services/team-chat-meeting-ai-worker.service';
import { TeamChatMeetingAiPdfService } from './services/team-chat-meeting-ai-pdf.service';
import { TeamChatPublicMeetingsController } from './controllers/team-chat-public-meetings.controller';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    FilesModule,
    DocumentLayoutsModule,
    NotificationsModule,
    PermissionsModule,
    // The gateway verifies the Agency access token in the handshake; the secret
    // is supplied per call, as in NotificationsModule.
    JwtModule.register({}),
    TypeOrmModule.forFeature(
      [
        AgencyChatChannel,
        AgencyChatChannelMember,
        AgencyChatMessage,
        AgencyChatMessageRead,
        AgencyChatAttachment,
        AgencyChatUserSettings,
        AgencyMeetingRoom,
        AgencyMeetingParticipant,
        AgencyMeetingEvent,
        AgencyMeetingAiSummary,
        AgencyMeetingAiSettings,
        FinanceAccount,
        FinanceCostCenter,
        // Read-only: the membership source that validates channel members and
        // mentions against the agency workspace (CCOM0.5 §22/§21).
        WorkspaceUserEntity,
        AgencyUserProfileEntity,
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [
    TeamChatPublicMeetingsController,
    TeamChatMeetingAiController,
    TeamChatController,
    TeamChatAttachmentsController,
    TeamChatMeetingsController,
  ],
  providers: [
    TeamChatMeetingAiService,
    TeamChatMeetingAiProviderService,
    TeamChatMeetingAiWorkerService,
    TeamChatMeetingAiPdfService,
    TeamChatChannelsService,
    TeamChatMessagesService,
    TeamChatMeetingsService,
    TeamChatAttachmentsService,
    TeamChatLiveKitProviderService,
    TeamChatNotificationPublisher,
    TeamChatUserSettingsService,
    TeamChatCardPostService,
    TeamChatGateway,
  ],
  exports: [
    TeamChatChannelsService,
    TeamChatMessagesService,
    TeamChatMeetingsService,
    TeamChatAttachmentsService,
    TeamChatLiveKitProviderService,
    TeamChatNotificationPublisher,
    TeamChatUserSettingsService,
    TeamChatCardPostService,
  ],
})
export class TeamChatModule {}
