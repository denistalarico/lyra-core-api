import { Module } from '@nestjs/common';
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

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    FilesModule,
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
      ],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [TeamChatController, TeamChatAttachmentsController, TeamChatMeetingsController],
  providers: [
    TeamChatChannelsService,
    TeamChatMessagesService,
    TeamChatMeetingsService,
    TeamChatAttachmentsService,
    TeamChatLiveKitProviderService,
    TeamChatUserSettingsService,
    TeamChatGateway,
  ],
  exports: [
    TeamChatChannelsService,
    TeamChatMessagesService,
    TeamChatMeetingsService,
    TeamChatAttachmentsService,
    TeamChatLiveKitProviderService,
    TeamChatUserSettingsService,
  ],
})
export class TeamChatModule {}
