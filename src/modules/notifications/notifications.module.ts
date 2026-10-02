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
import { ClientNotificationSurfaceRegistry } from './ports/client-notification-surface.port';
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
    /**
     * NTF-C1 §48 — declared *here*, by the module that declares the processor
     * which consumes it. That is the whole correctness condition: a provider's
     * dependencies resolve in its declaring module, so a registry bound in
     * another module would inject as `undefined`. AP3's
     * `CLIENT_APPROVAL_NOTIFIER` did exactly that and silently dropped every
     * client email for the life of the feature.
     */
    ClientNotificationSurfaceRegistry,
  ],
  exports: [
    TypeOrmModule,
    NotificationCatalogService,
    NotificationEventProcessorService,
    NotificationsService,
    NotificationPushService,
    NotificationRealtimeService,
    ClientNotificationSurfaceRegistry,
  ],
})
export class NotificationsModule {}
