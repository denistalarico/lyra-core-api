import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PermissionsModule } from '../permissions';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { ScheduledItemEntity } from './entities/scheduled-item.entity';
import { ScheduledItemParticipantEntity } from './entities/scheduled-item-participant.entity';
import { ScheduledItemReminderEntity } from './entities/scheduled-item-reminder.entity';

@Module({
  imports: [
    PermissionsModule,
    TypeOrmModule.forFeature([
      ScheduledItemEntity,
      ScheduledItemParticipantEntity,
      ScheduledItemReminderEntity,
    ]),
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
