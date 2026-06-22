import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as webpush from 'web-push';
import { NotificationPushSubscriptionEntity } from '../entities';

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

@Injectable()
export class NotificationPushService {
  private readonly logger = new Logger(NotificationPushService.name);
  private vapidConfigured = false;

  constructor(
    @InjectRepository(NotificationPushSubscriptionEntity, 'agency')
    private readonly subscriptionsRepo: Repository<NotificationPushSubscriptionEntity>,
    private readonly configService: ConfigService,
  ) {
    const publicKey = this.configService.get<string>(
      'WEB_PUSH_VAPID_PUBLIC_KEY',
    );
    const privateKey = this.configService.get<string>(
      'WEB_PUSH_VAPID_PRIVATE_KEY',
    );
    const subject =
      this.configService.get<string>('WEB_PUSH_VAPID_SUBJECT') ??
      'mailto:suporte@lyrasuite.com';

    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.vapidConfigured = true;
    } else {
      this.logger.warn(
        'WEB_PUSH_VAPID_PUBLIC_KEY/WEB_PUSH_VAPID_PRIVATE_KEY not set — push notifications are disabled.',
      );
    }
  }

  getPublicKey(): string | null {
    return this.configService.get<string>('WEB_PUSH_VAPID_PUBLIC_KEY') ?? null;
  }

  async subscribe(
    tenantId: string,
    userId: string,
    endpoint: string,
    keys: { p256dh: string; auth: string },
    userAgent?: string | null,
  ) {
    const existing = await this.subscriptionsRepo.findOne({
      where: { endpoint },
    });

    await this.subscriptionsRepo.save(
      existing
        ? {
            ...existing,
            tenantId,
            userId,
            p256dhKey: keys.p256dh,
            authKey: keys.auth,
            userAgent: userAgent ?? existing.userAgent,
            lastUsedAt: new Date(),
          }
        : this.subscriptionsRepo.create({
            tenantId,
            userId,
            endpoint,
            p256dhKey: keys.p256dh,
            authKey: keys.auth,
            userAgent: userAgent ?? null,
            lastUsedAt: new Date(),
          }),
    );

    return { success: true };
  }

  async unsubscribe(tenantId: string, userId: string, endpoint: string) {
    await this.subscriptionsRepo.delete({ tenantId, userId, endpoint });
    return { success: true };
  }

  async sendToUsers(
    tenantId: string,
    userIds: string[],
    payload: PushPayload,
  ): Promise<void> {
    if (!this.vapidConfigured || userIds.length === 0) {
      return;
    }

    const subscriptions = await this.subscriptionsRepo.find({
      where: { tenantId, userId: In(userIds) },
    });

    if (subscriptions.length === 0) {
      return;
    }

    const body = JSON.stringify(payload);

    await Promise.allSettled(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dhKey,
                auth: subscription.authKey,
              },
            },
            body,
          );

          await this.subscriptionsRepo.update(subscription.id, {
            lastUsedAt: new Date(),
          });
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;

          if (statusCode === 404 || statusCode === 410) {
            await this.subscriptionsRepo.delete(subscription.id);
            return;
          }

          this.logger.warn(
            `Failed to send push notification to subscription ${subscription.id}: ${(error as Error).message}`,
          );
        }
      }),
    );
  }
}
