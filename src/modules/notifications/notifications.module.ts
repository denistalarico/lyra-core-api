import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationCatalogService } from './catalog';
import {
  NotificationsController,
  NotificationsDevController,
} from './controllers';
import {
  NotificationDeliveryEntity,
  NotificationEntity,
  NotificationRecipientEntity,
} from './entities';
import { SelfNotificationPolicy } from './policies';
import {
  NotificationEventProcessorService,
  NotificationRecipientResolverService,
  NotificationsService,
} from './services';

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [
        NotificationEntity,
        NotificationRecipientEntity,
        NotificationDeliveryEntity,
      ],
      'agency',
    ),
  ],
  controllers: [
    NotificationsController,
    NotificationsDevController,
  ],
  providers: [
    NotificationCatalogService,
    NotificationRecipientResolverService,
    SelfNotificationPolicy,
    NotificationEventProcessorService,
    NotificationsService,
  ],
  exports: [
    TypeOrmModule,
    NotificationCatalogService,
    NotificationEventProcessorService,
    NotificationsService,
  ],
})
export class NotificationsModule {}
