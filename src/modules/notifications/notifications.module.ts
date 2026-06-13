import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationCatalogService } from './catalog';
import {
  NotificationsController,
  NotificationsDevController,
} from './controllers';
import { NotificationsGateway } from './gateways/notifications.gateway';
import {
  NotificationDeliveryEntity,
  NotificationEntity,
  NotificationRecipientEntity,
} from './entities';
import { SelfNotificationPolicy } from './policies';
import {
  NotificationEventProcessorService,
  NotificationRealtimeService,
  NotificationRecipientResolverService,
  NotificationsService,
} from './services';

@Module({
  imports: [
    JwtModule.register({}),
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
    NotificationRealtimeService,
    NotificationsService,
    NotificationsGateway,
  ],
  exports: [
    TypeOrmModule,
    NotificationCatalogService,
    NotificationEventProcessorService,
    NotificationsService,
  ],
})
export class NotificationsModule {}
