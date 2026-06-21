import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications';
import { EmailModule } from '../email/email.module';
import { ActivitiesController } from './controllers/activities.controller';
import { ActivitiesService } from './services/activities.service';
import { ActivityNotificationPublisher } from './services/activity-notification.publisher';
import { AgencyActivity, AgencyActivityLink } from './entities';

const AGENCY_CONNECTION = 'agency';

@Module({
  imports: [
    NotificationsModule,
    EmailModule,
    TypeOrmModule.forFeature(
      [AgencyActivity, AgencyActivityLink],
      AGENCY_CONNECTION,
    ),
  ],
  controllers: [ActivitiesController],
  providers: [ActivitiesService, ActivityNotificationPublisher],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
