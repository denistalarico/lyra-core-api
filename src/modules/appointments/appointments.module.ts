import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InboxDomainOutboxEntity } from '../inbox/entities/inbox-domain-outbox.entity';
import { PermissionsModule } from '../permissions';
import { TeamChatModule } from '../team-chat/team-chat.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { ScheduledItemEntity } from './entities/scheduled-item.entity';
import { ScheduledItemParticipantEntity } from './entities/scheduled-item-participant.entity';
import { ScheduledItemReminderEntity } from './entities/scheduled-item-reminder.entity';

@Module({
  imports: [
    PermissionsModule,
    TeamChatModule,
    TypeOrmModule.forFeature(
      [
        ScheduledItemEntity,
        ScheduledItemParticipantEntity,
        ScheduledItemReminderEntity,
        InboxDomainOutboxEntity,
      ],
      'agency',
    ),
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
