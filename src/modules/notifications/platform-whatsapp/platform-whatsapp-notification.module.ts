import { Module } from '@nestjs/common';
import {
  EnvPlatformWhatsAppNotificationConfigProvider,
  PLATFORM_WHATSAPP_NOTIFICATION_CONFIG,
} from './platform-whatsapp-notification.config';
import { PlatformWhatsAppNotificationSender } from './platform-whatsapp-notification.sender';

/**
 * The Platform WhatsApp Notification Provider.
 *
 * Deliberately separate from the Inbox WhatsApp channel: this is the platform's
 * own internal-alert transport, default-disabled, reading its credentials from
 * the environment through a swappable config provider. Exposes only the sender;
 * the env config provider is bound behind an injection token so an Admin-DB
 * implementation can replace it later without touching consumers.
 */
@Module({
  providers: [
    {
      provide: PLATFORM_WHATSAPP_NOTIFICATION_CONFIG,
      useFactory: () => new EnvPlatformWhatsAppNotificationConfigProvider(),
    },
    PlatformWhatsAppNotificationSender,
  ],
  exports: [PlatformWhatsAppNotificationSender],
})
export class PlatformWhatsAppNotificationModule {}
