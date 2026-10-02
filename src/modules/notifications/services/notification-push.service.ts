import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as webpush from 'web-push';
import { NotificationPushSubscriptionEntity } from '../entities';
import { NotificationRecipientSurface } from '../enums';

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

export type PushUserDeliveryStatus = 'sent' | 'failed' | 'unavailable';

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

  /**
   * NTF-C1 §24/§58 — the surface is a parameter of the *boundary*, defaulted
   * to Agency so every existing caller is unchanged, and never read from a
   * request body.
   *
   * WHAT HAPPENS WHEN ONE BROWSER REGISTERS FROM BOTH SURFACES
   * ----------------------------------------------------------
   * A push endpoint is issued per service-worker registration, and both
   * surfaces may be served by the same worker scope — so the same browser can
   * present the *same* endpoint from the Agency app and from the Client Area.
   * The endpoint stays globally unique, so this re-registration **moves** the
   * row to the surface that registered last, rather than creating a second
   * row.
   *
   * That is deliberate and it is the honest reading of the Push API: there is
   * one channel to that browser, and the last surface to ask owns it. The
   * alternative — two rows for one endpoint — would make both surfaces push to
   * the same device channel, which is precisely the cross-surface leak §25
   * forbids. Documented as a known limitation in the NTF-C1 report: a user
   * logged into both surfaces in one browser receives push for whichever they
   * subscribed from last, not both.
   */
  async subscribe(
    tenantId: string,
    userId: string,
    endpoint: string,
    keys: { p256dh: string; auth: string },
    userAgent?: string | null,
    surface: NotificationRecipientSurface = NotificationRecipientSurface.AGENCY,
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
            surface,
            p256dhKey: keys.p256dh,
            authKey: keys.auth,
            userAgent: userAgent ?? existing.userAgent,
            lastUsedAt: new Date(),
          }
        : this.subscriptionsRepo.create({
            tenantId,
            userId,
            surface,
            endpoint,
            p256dhKey: keys.p256dh,
            authKey: keys.auth,
            userAgent: userAgent ?? null,
            lastUsedAt: new Date(),
          }),
    );

    return { success: true };
  }

  /**
   * Scoped by surface so a client boundary cannot remove an Agency
   * subscription of the same identity, and vice versa.
   */
  async unsubscribe(
    tenantId: string,
    userId: string,
    endpoint: string,
    surface: NotificationRecipientSurface = NotificationRecipientSurface.AGENCY,
  ) {
    await this.subscriptionsRepo.delete({
      tenantId,
      userId,
      endpoint,
      surface,
    });
    return { success: true };
  }

  /**
   * NTF-C1 §25/§26 — the fan-out is surface-scoped in the query itself.
   *
   * One VAPID configuration serves both surfaces (§26): the keys identify the
   * *server* to the push provider, not the audience, so a second pair would
   * add key management with no isolation benefit. The isolation that matters
   * is which endpoints are selected, and that is this `where`.
   */
  async sendToUsers(
    tenantId: string,
    userIds: string[],
    payload: PushPayload,
    surface: NotificationRecipientSurface = NotificationRecipientSurface.AGENCY,
  ): Promise<Map<string, PushUserDeliveryStatus>> {
    const outcomes = new Map<string, PushUserDeliveryStatus>();
    if (!this.vapidConfigured || userIds.length === 0) {
      userIds.forEach((userId) => outcomes.set(userId, 'unavailable'));
      return outcomes;
    }

    const subscriptions = await this.subscriptionsRepo.find({
      where: { tenantId, userId: In(userIds), surface },
    });

    if (subscriptions.length === 0) {
      userIds.forEach((userId) => outcomes.set(userId, 'unavailable'));
      return outcomes;
    }

    const body = JSON.stringify(payload);
    const subscriptionsByUser = new Map<
      string,
      NotificationPushSubscriptionEntity[]
    >();
    for (const subscription of subscriptions) {
      const current = subscriptionsByUser.get(subscription.userId) ?? [];
      current.push(subscription);
      subscriptionsByUser.set(subscription.userId, current);
    }

    await Promise.all(
      userIds.map(async (userId) => {
        const userSubscriptions = subscriptionsByUser.get(userId) ?? [];
        if (userSubscriptions.length === 0) {
          outcomes.set(userId, 'unavailable');
          return;
        }
        const attempts = await Promise.all(
          userSubscriptions.map(async (subscription) => {
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
              return 'sent' as const;
            } catch (error) {
              const statusCode = (error as { statusCode?: number }).statusCode;

              if (statusCode === 404 || statusCode === 410) {
                await this.subscriptionsRepo.delete(subscription.id);
                return 'unavailable' as const;
              }

              this.logger.warn(
                `Failed to send push notification to subscription ${subscription.id}: ${(error as Error).message}`,
              );
              return 'failed' as const;
            }
          }),
        );
        outcomes.set(
          userId,
          attempts.includes('sent')
            ? 'sent'
            : attempts.includes('failed')
              ? 'failed'
              : 'unavailable',
        );
      }),
    );
    return outcomes;
  }
}
