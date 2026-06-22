import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import {
  AgencyUserNotificationPreferencesEntity,
  AgencyWorkspaceEmailSettingsEntity,
  AgencyWorkspaceUserEntity,
} from '../agency/entities/agency-settings.entities';
import { EmailModule } from '../email/email.module';
import { NotificationCatalogService } from './catalog';
import {
  NotificationsController,
  NotificationsDevController,
} from './controllers';
import { NotificationsGateway } from './gateways/notifications.gateway';
import {
  NotificationDeliveryEntity,
  NotificationEntity,
  NotificationPushSubscriptionEntity,
  NotificationRecipientEntity,
} from './entities';
import { SelfNotificationPolicy } from './policies';
import {
  NotificationEventProcessorService,
  NotificationPushService,
  NotificationRealtimeService,
  NotificationRecipientResolverService,
  NotificationsService,
} from './services';

@Module({
  imports: [
    JwtModule.register({}),
    EmailModule,
    TypeOrmModule.forFeature(
      [
        NotificationEntity,
        NotificationRecipientEntity,
        NotificationDeliveryEntity,
        NotificationPushSubscriptionEntity,
        AgencyUserNotificationPreferencesEntity,
        AgencyWorkspaceUserEntity,
        AgencyWorkspaceEmailSettingsEntity,
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
    NotificationPushService,
    NotificationRealtimeService,
    NotificationsService,
    NotificationsGateway,
    SettingsCryptoService,
  ],
  exports: [
    TypeOrmModule,
    NotificationCatalogService,
    NotificationEventProcessorService,
    NotificationsService,
  ],
})
export class NotificationsModule {}
