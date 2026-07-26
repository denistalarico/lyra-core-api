import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { SettingsCryptoService } from '../../../common/crypto/settings-crypto.service';
import {
  AgencyUserNotificationPreferencesEntity,
  AgencyWorkspaceEmailSettingsEntity,
  AgencyWorkspaceUserEntity,
} from '../../agency/entities/agency-settings.entities';
import {
  EmailService,
  type EmailTransportOverride,
} from '../../email/email.service';
import { renderTransactionalEmail } from '../../email/templates/transactional-email.template';
import { NotificationCatalogService } from '../catalog';
import {
  NotificationDeliveryEntity,
  NotificationEntity,
  NotificationRecipientEntity,
} from '../entities';
import {
  NotificationDeliveryChannel,
  NotificationDeliveryStatus,
} from '../enums';
import { SelfNotificationPolicy } from '../policies/self-notification.policy';
import {
  NotificationProcessingResult,
  NotificationSourceEvent,
} from '../types';
import { NotificationPushService } from './notification-push.service';
import { NotificationRealtimeService } from './notification-realtime.service';
import { NotificationRecipientResolverService } from './notification-recipient-resolver.service';

const NOTIFICATION_PREFERENCE_GROUP_BY_MODULE: Record<string, string> = {
  'team-chat': 'messages',
  inbox: 'messages',
  finance: 'finance',
  tasks: 'tasks',
  projects: 'tasks',
  activities: 'tasks',
  calendar: 'calendar',
  clients: 'clients',
  sales: 'clients',
  security: 'security',
  settings: 'system',
  system: 'system',
  dashboards: 'system',
  contracts: 'system',
  team: 'system',
  knowledge: 'system',
};

type NotificationPersistenceResult =
  | (Extract<NotificationProcessingResult, { status: 'created' }> & {
      realtimeRecipientIds: string[];
      pendingEmailDeliveries: { deliveryId: string; email: string }[];
      pendingPushDeliveries: { deliveryId: string; userId: string }[];
    })
  | Extract<NotificationProcessingResult, { status: 'duplicate' }>
  | Extract<NotificationProcessingResult, { status: 'skipped' }>;

@Injectable()
export class NotificationEventProcessorService {
  private readonly logger = new Logger(NotificationEventProcessorService.name);

  constructor(
    @InjectDataSource('agency')
    private readonly dataSource: DataSource,
    @InjectRepository(AgencyUserNotificationPreferencesEntity, 'agency')
    private readonly preferencesRepo: Repository<AgencyUserNotificationPreferencesEntity>,
    @InjectRepository(AgencyWorkspaceUserEntity, 'agency')
    private readonly workspaceUsersRepo: Repository<AgencyWorkspaceUserEntity>,
    @InjectRepository(AgencyWorkspaceEmailSettingsEntity, 'agency')
    private readonly emailSettingsRepo: Repository<AgencyWorkspaceEmailSettingsEntity>,
    private readonly catalog: NotificationCatalogService,
    private readonly recipientResolver: NotificationRecipientResolverService,
    private readonly selfNotificationPolicy: SelfNotificationPolicy,
    private readonly realtimeService: NotificationRealtimeService,
    private readonly emailService: EmailService,
    private readonly cryptoService: SettingsCryptoService,
    private readonly configService: ConfigService,
    private readonly pushService: NotificationPushService,
  ) {}

  async process(
    event: NotificationSourceEvent,
  ): Promise<NotificationProcessingResult> {
    const definition = this.catalog.requireDefinition(
      event.productKey,
      event.eventType,
    );

    if (definition.moduleKey !== event.moduleKey) {
      throw new Error(
        `Notification module mismatch for ${event.eventType}: ` +
          `expected ${definition.moduleKey}, received ${event.moduleKey}`,
      );
    }

    const resolvedRecipients = this.recipientResolver.resolve(
      event,
      definition,
    );

    const recipients = this.selfNotificationPolicy.apply(
      event,
      resolvedRecipients,
      definition.selfNotificationPolicy,
    );

    if (recipients.length === 0) {
      return {
        status: 'skipped',
        reason: 'no_recipients',
        recipientCount: 0,
      };
    }

    const recipientUserIds = recipients.map((recipient) => recipient.userId);
    const requestedChannels = this.requestedChannels(event);
    const wantsChannel = (channel: NotificationDeliveryChannel) =>
      requestedChannels === null || requestedChannels.has(channel);

    const [inAppRecipients, emailRecipients, pushRecipients] =
      await Promise.all([
        wantsChannel(NotificationDeliveryChannel.IN_APP)
          ? this.resolveInAppRecipients(event, recipientUserIds)
          : Promise.resolve(new Set<string>()),
        wantsChannel(NotificationDeliveryChannel.EMAIL)
          ? this.resolveEmailRecipients(
              event,
              definition.moduleKey,
              recipientUserIds,
            )
          : Promise.resolve(new Map<string, string>()),
        wantsChannel(NotificationDeliveryChannel.PUSH)
          ? this.resolvePushRecipients(
              event,
              definition.moduleKey,
              recipientUserIds,
            )
          : Promise.resolve(new Set<string>()),
      ]);

    const result: NotificationPersistenceResult =
      await this.dataSource.transaction(async (manager) => {
        const notificationRepo = manager.getRepository(NotificationEntity);

        const existing = await notificationRepo.findOne({
          where: {
            tenantId: event.tenantId,
            sourceEventId: event.eventId,
          },
          relations: {
            recipients: true,
          },
        });

        if (existing) {
          return {
            status: 'duplicate',
            notificationId: existing.id,
            recipientCount: existing.recipients?.length ?? 0,
          };
        }

        const occurredAt = new Date(event.occurredAt);

        if (Number.isNaN(occurredAt.getTime())) {
          throw new Error(
            `Invalid notification occurredAt: ${event.occurredAt}`,
          );
        }

        const expiresAt = definition.expiresAfterSeconds
          ? new Date(
              occurredAt.getTime() + definition.expiresAfterSeconds * 1000,
            )
          : null;

        const notification = notificationRepo.create({
          tenantId: event.tenantId,
          workspaceId: event.workspaceId ?? null,
          managedTenantId: event.managedTenantId ?? null,

          productKey: definition.productKey,
          moduleKey: definition.moduleKey,
          eventType: definition.eventType,
          category: definition.category,
          priority: definition.defaultPriority,

          title: this.resolveTitle(event),
          body: this.resolveBody(event),

          actionType: definition.defaultActionType,
          actionUrl: this.optionalString(event.payload.actionUrl),

          resourceType: event.resourceType ?? null,
          resourceId: event.resourceId ?? null,

          actorType: event.actorType,
          actorUserId: event.actorUserId ?? null,
          initiatedByUserId: event.initiatedByUserId ?? null,

          sourceEventId: event.eventId,
          deduplicationKey: this.optionalString(event.payload.deduplicationKey),

          templateKey: `notifications.${event.eventType}`,
          templateVariables: event.payload,
          metadata: this.resolveMetadata(event),

          occurredAt,
          expiresAt,
        });

        const savedNotification = await notificationRepo.save(notification);

        const recipientRepo = manager.getRepository(
          NotificationRecipientEntity,
        );

        const recipientEntities = recipients.map((recipient) =>
          recipientRepo.create({
            notificationId: savedNotification.id,
            userId: recipient.userId,
            interestReason: recipient.interestReason,
            seenAt: null,
            readAt: null,
            archivedAt: null,
            dismissedAt: null,
          }),
        );

        const savedRecipients = await recipientRepo.save(recipientEntities);

        const deliveryRepo = manager.getRepository(NotificationDeliveryEntity);

        const deliveries = savedRecipients.flatMap((recipient) => {
          const extraDeliveries: NotificationDeliveryEntity[] = [];

          if (inAppRecipients.has(recipient.userId)) {
            extraDeliveries.push(
              deliveryRepo.create({
                notificationRecipientId: recipient.id,
                channel: NotificationDeliveryChannel.IN_APP,
                status: NotificationDeliveryStatus.SENT,
                scheduledAt: null,
                sentAt: new Date(),
                failedAt: null,
                failureReason: null,
                attempts: 1,
                providerMessageId: null,
              }),
            );
          }

          if (emailRecipients.has(recipient.userId)) {
            extraDeliveries.push(
              deliveryRepo.create({
                notificationRecipientId: recipient.id,
                channel: NotificationDeliveryChannel.EMAIL,
                status: NotificationDeliveryStatus.PENDING,
                scheduledAt: null,
                sentAt: null,
                failedAt: null,
                failureReason: null,
                attempts: 0,
                providerMessageId: null,
              }),
            );
          }

          if (pushRecipients.has(recipient.userId)) {
            extraDeliveries.push(
              deliveryRepo.create({
                notificationRecipientId: recipient.id,
                channel: NotificationDeliveryChannel.PUSH,
                status: NotificationDeliveryStatus.PENDING,
                scheduledAt: null,
                sentAt: null,
                failedAt: null,
                failureReason: null,
                attempts: 0,
                providerMessageId: null,
              }),
            );
          }

          return extraDeliveries;
        });

        const savedDeliveries = await deliveryRepo.save(deliveries);

        const pendingEmailDeliveries = savedDeliveries
          .filter(
            (delivery) =>
              delivery.channel === NotificationDeliveryChannel.EMAIL,
          )
          .map((delivery) => {
            const recipient = savedRecipients.find(
              (candidate) => candidate.id === delivery.notificationRecipientId,
            );

            return {
              deliveryId: delivery.id,
              email: emailRecipients.get(recipient!.userId)!,
            };
          });

        const pendingPushDeliveries = savedDeliveries
          .filter(
            (delivery) => delivery.channel === NotificationDeliveryChannel.PUSH,
          )
          .map((delivery) => {
            const recipient = savedRecipients.find(
              (candidate) => candidate.id === delivery.notificationRecipientId,
            );

            return {
              deliveryId: delivery.id,
              userId: recipient!.userId,
            };
          });

        return {
          status: 'created',
          notificationId: savedNotification.id,
          recipientCount: savedRecipients.length,
          pendingEmailDeliveries,
          pendingPushDeliveries,
          realtimeRecipientIds: savedDeliveries
            .filter(
              (delivery) =>
                delivery.channel === NotificationDeliveryChannel.IN_APP &&
                delivery.status === NotificationDeliveryStatus.SENT,
            )
            .map((delivery) => delivery.notificationRecipientId),
        };
      });

    if (result.status === 'created') {
      await Promise.allSettled(
        result.realtimeRecipientIds.map((recipientId) =>
          this.realtimeService.emitCreatedForRecipient(recipientId),
        ),
      );

      if (result.pendingEmailDeliveries.length > 0) {
        await this.sendEmailDeliveries(event, result.pendingEmailDeliveries);
      }

      if (result.pendingPushDeliveries.length > 0) {
        await this.sendPushDeliveries(event, result.pendingPushDeliveries);
      }
    }

    return {
      status: result.status,
      notificationId: result.notificationId,
      recipientCount: result.recipientCount,
    };
  }

  private async resolveEmailRecipients(
    event: NotificationSourceEvent,
    moduleKey: string,
    recipientUserIds: string[],
  ): Promise<Map<string, string>> {
    const preferenceGroup =
      NOTIFICATION_PREFERENCE_GROUP_BY_MODULE[moduleKey] ?? 'system';

    const [preferenceRows, workspaceUsers] = await Promise.all([
      this.preferencesRepo.find({
        where: { tenantId: event.tenantId, userId: In(recipientUserIds) },
      }),
      event.workspaceId
        ? this.workspaceUsersRepo.find({
            where: {
              tenantId: event.tenantId,
              workspaceId: event.workspaceId,
              userId: In(recipientUserIds),
            },
          })
        : Promise.resolve([]),
    ]);

    const emailByUserId = new Map(
      workspaceUsers
        .filter(
          (user): user is AgencyWorkspaceUserEntity & { userId: string } =>
            Boolean(user.userId && user.email),
        )
        .map((user) => [user.userId, user.email]),
    );

    const preferencesByUserId = new Map(
      preferenceRows.map((row) => [row.userId, row.preferences]),
    );

    const result = new Map<string, string>();

    for (const userId of recipientUserIds) {
      const email = emailByUserId.get(userId);

      if (!email) {
        continue;
      }

      const preferences = preferencesByUserId.get(userId) ?? [];
      const entry = this.findPreference(
        preferences,
        event.eventType,
        preferenceGroup,
      ) as { email?: boolean; channels?: { email?: boolean } } | undefined;
      const wantsEmail = entry?.email ?? entry?.channels?.email ?? false;

      if (wantsEmail) {
        result.set(userId, email);
      }
    }

    return result;
  }

  private async resolvePushRecipients(
    event: NotificationSourceEvent,
    moduleKey: string,
    recipientUserIds: string[],
  ): Promise<Set<string>> {
    const preferenceGroup =
      NOTIFICATION_PREFERENCE_GROUP_BY_MODULE[moduleKey] ?? 'system';

    const preferenceRows = await this.preferencesRepo.find({
      where: { tenantId: event.tenantId, userId: In(recipientUserIds) },
    });

    const preferencesByUserId = new Map(
      preferenceRows.map((row) => [row.userId, row.preferences]),
    );

    const result = new Set<string>();

    for (const userId of recipientUserIds) {
      const preferences = preferencesByUserId.get(userId) ?? [];
      const entry = this.findPreference(
        preferences,
        event.eventType,
        preferenceGroup,
      ) as { push?: boolean; channels?: { push?: boolean } } | undefined;
      const wantsPush = entry?.push ?? entry?.channels?.push ?? false;

      if (wantsPush) {
        result.add(userId);
      }
    }

    return result;
  }

  private async resolveInAppRecipients(
    event: NotificationSourceEvent,
    recipientUserIds: string[],
  ): Promise<Set<string>> {
    // Existing notification events retain their historical always-in-app
    // behaviour. The exact hot-lead preference is opt-out: absent means the
    // primary System channel stays enabled.
    if (event.eventType !== 'leadflow.hot_lead.detected') {
      return new Set(recipientUserIds);
    }
    const rows = await this.preferencesRepo.find({
      where: { tenantId: event.tenantId, userId: In(recipientUserIds) },
    });
    const byUser = new Map(rows.map((row) => [row.userId, row.preferences]));
    return new Set(
      recipientUserIds.filter((userId) => {
        const preferences = byUser.get(userId) ?? [];
        const exact = preferences.find(
          (preference) => preference.key === event.eventType,
        ) as { app?: boolean; channels?: { app?: boolean } } | undefined;
        if (!exact) return true;
        return exact.app ?? exact.channels?.app ?? true;
      }),
    );
  }

  private findPreference(
    preferences: Array<Record<string, unknown>>,
    eventType: string,
    fallbackKey: string,
  ): Record<string, unknown> | undefined {
    return (
      preferences.find((preference) => preference.key === eventType) ??
      preferences.find((preference) => preference.key === fallbackKey)
    );
  }

  private async getEmailTransportOverride(
    tenantId: string,
    workspaceId?: string | null,
  ): Promise<EmailTransportOverride | undefined> {
    const settings = await this.emailSettingsRepo.findOne({
      where: workspaceId ? { tenantId, workspaceId } : { tenantId },
      order: { updatedAt: 'DESC' },
    });

    if (
      !settings?.smtpHost ||
      !settings.smtpUser ||
      !settings.smtpPasswordEncrypted ||
      !settings.fromEmail
    ) {
      return undefined;
    }

    const smtpPassword = this.cryptoService.decrypt(
      settings.smtpPasswordEncrypted,
    );

    if (!smtpPassword) {
      return undefined;
    }

    return {
      smtpHost: settings.smtpHost,
      smtpPort: settings.smtpPort ?? 587,
      smtpSecure: settings.smtpSecure,
      smtpUser: settings.smtpUser,
      smtpPassword,
      fromName: settings.fromName,
      fromEmail: settings.fromEmail,
    };
  }

  private async sendEmailDeliveries(
    event: NotificationSourceEvent,
    pendingDeliveries: { deliveryId: string; email: string }[],
  ) {
    const override = await this.getEmailTransportOverride(
      event.tenantId,
      event.workspaceId,
    );

    const title = this.resolveTitle(event);
    const body = this.resolveBody(event);
    const frontendUrl =
      this.configService.get<string>('AGENCY_FRONTEND_URL') ??
      'http://localhost:3003';

    const { html, text } = renderTransactionalEmail({
      title,
      intro: body,
      buttonLabel: 'Abrir Lyra Agency',
      buttonUrl: frontendUrl,
    });

    const deliveryRepo = this.dataSource.getRepository(
      NotificationDeliveryEntity,
    );

    await Promise.allSettled(
      pendingDeliveries.map(async (pending) => {
        try {
          await this.emailService.sendEmail({
            to: pending.email,
            subject: title,
            html,
            text,
            override,
          });

          await deliveryRepo.update(pending.deliveryId, {
            status: NotificationDeliveryStatus.SENT,
            sentAt: new Date(),
            attempts: 1,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to send email notification delivery ${pending.deliveryId}: ${(error as Error).message}`,
          );

          await deliveryRepo.update(pending.deliveryId, {
            status: NotificationDeliveryStatus.FAILED,
            failedAt: new Date(),
            failureReason:
              (error as Error).message?.slice(0, 250) ?? 'unknown_error',
            attempts: 1,
          });
        }
      }),
    );
  }

  private async sendPushDeliveries(
    event: NotificationSourceEvent,
    pendingDeliveries: { deliveryId: string; userId: string }[],
  ) {
    const title = this.resolveTitle(event);
    const body = this.resolveBody(event);
    const frontendUrl =
      this.configService.get<string>('AGENCY_FRONTEND_URL') ??
      'http://localhost:3003';
    const actionUrl = this.optionalString(event.payload.actionUrl);

    const deliveryRepo = this.dataSource.getRepository(
      NotificationDeliveryEntity,
    );
    const userIds = [
      ...new Set(pendingDeliveries.map((pending) => pending.userId)),
    ];

    try {
      const outcomes = await this.pushService.sendToUsers(
        event.tenantId,
        userIds,
        {
          title,
          body,
          url: actionUrl ?? frontendUrl,
        },
      );
      await Promise.all(
        pendingDeliveries.map((pending) => {
          const outcome = outcomes.get(pending.userId) ?? 'unavailable';
          if (outcome === 'sent') {
            return deliveryRepo.update(pending.deliveryId, {
              status: NotificationDeliveryStatus.SENT,
              sentAt: new Date(),
              attempts: 1,
            });
          }
          return deliveryRepo.update(pending.deliveryId, {
            status:
              outcome === 'failed'
                ? NotificationDeliveryStatus.FAILED
                : NotificationDeliveryStatus.SKIPPED,
            failedAt: outcome === 'failed' ? new Date() : null,
            failureReason:
              outcome === 'failed'
                ? 'web_push_provider_failed'
                : 'skipped_web_push_unavailable',
            attempts: outcome === 'failed' ? 1 : 0,
          });
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to send push notification deliveries: ${(error as Error).message}`,
      );

      await deliveryRepo.update(
        pendingDeliveries.map((pending) => pending.deliveryId),
        {
          status: NotificationDeliveryStatus.FAILED,
          failedAt: new Date(),
          failureReason:
            (error as Error).message?.slice(0, 250) ?? 'unknown_error',
          attempts: 1,
        },
      );
    }
  }

  private resolveTitle(event: NotificationSourceEvent): string {
    const title = event.payload.title;

    if (typeof title === 'string' && title.trim()) {
      return title.trim().slice(0, 180);
    }

    return event.eventType;
  }

  private requestedChannels(
    event: NotificationSourceEvent,
  ): Set<NotificationDeliveryChannel> | null {
    const raw = event.payload.deliveryChannels;
    if (!Array.isArray(raw)) return null;
    const allowed = new Set(Object.values(NotificationDeliveryChannel));
    return new Set(
      raw.filter(
        (item): item is NotificationDeliveryChannel =>
          typeof item === 'string' &&
          allowed.has(item as NotificationDeliveryChannel),
      ),
    );
  }

  private resolveBody(event: NotificationSourceEvent): string {
    const body = event.payload.body ?? event.payload.message;

    if (typeof body === 'string' && body.trim()) {
      return body.trim();
    }

    return event.eventType;
  }

  private resolveMetadata(
    event: NotificationSourceEvent,
  ): Record<string, unknown> {
    const metadata = event.payload.metadata;

    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      return metadata as Record<string, unknown>;
    }

    return {};
  }

  private optionalString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();

    return normalized || null;
  }
}
