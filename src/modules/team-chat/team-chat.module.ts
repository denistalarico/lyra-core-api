import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  AgencyChatAttachment,
  AgencyChatChannel,
  AgencyChatChannelMember,
  AgencyChatMessage,
  AgencyChatMessageRead,
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
import { TeamChatAttachmentsController } from './controllers/team-chat-attachments.controller';
import { TeamChatMeetingsController } from './controllers/team-chat-meetings.controller';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        AgencyChatChannel,
        AgencyChatChannelMember,
        AgencyChatMessage,
        AgencyChatMessageRead,
        AgencyChatAttachment,
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
    TeamChatGateway,
  ],
  exports: [
    TeamChatChannelsService,
    TeamChatMessagesService,
    TeamChatMeetingsService,
    TeamChatAttachmentsService,
    TeamChatLiveKitProviderService,
  ],
})
export class TeamChatModule {}
