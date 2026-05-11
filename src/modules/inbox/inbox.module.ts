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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InboxChannelEntity,
      InboxConversationEntity,
      InboxMessageEntity,
      InboxSettingsEntity,
      InboxSettingsEntity,
      InboxConversationParticipantEntity,
      InboxConversationEventEntity,
      WorkspaceUserEntity,
      UserProfileEntity,
    ]),
  ],
  controllers: [InboxController, InboxSettingsController],
  providers: [InboxService, InboxSettingsService],
  exports: [InboxService, InboxSettingsService],
})
export class InboxModule {}
