import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InboxChannelEntity } from './entities/inbox-channel.entity';
import { InboxConversationEntity } from './entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from './entities/inbox-conversation-event.entity';
import { InboxConversationParticipantEntity } from './entities/inbox-conversation-participant.entity';
import { InboxMessageEntity } from './entities/inbox-message.entity';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InboxChannelEntity,
      InboxConversationEntity,
      InboxMessageEntity,
      InboxConversationParticipantEntity,
      InboxConversationEventEntity,
    ]),
  ],
  controllers: [InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
