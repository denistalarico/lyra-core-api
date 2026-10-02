import { Injectable, Logger, Optional } from '@nestjs/common';
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
  NotificationAudience,
  NotificationDeliveryChannel,
  NotificationDeliveryStatus,
  NotificationRecipientSurface,
} from '../enums';
import { SelfNotificationPolicy } from '../policies/self-notification.policy';
import {
  ClientNotificationRecipient,
  ClientNotificationSurfaceRegistry,
} from '../ports/client-notification-surface.port';
import {
  NotificationExplicitRecipient,
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
      /**
       * Split from the Agency list because the rendered mail differs by
       * surface: the CTA of a client email must point at a Client Area route
       * (§16), and the Agency copy must stay byte-for-byte what it is today
       * (§55).
       */
      pendingClientEmailDeliveries: { deliveryId: string; email: string }[];
      pendingPushDeliveries: {
        deliveryId: string;
        userId: string;
        surface: NotificationRecipientSurface;
      }[];
    })
  | Extract<NotificationProcessingResult, { status: 'duplicate' }>
  | Extract<NotificationProcessingResult, { status: 'skipped' }>;

/**
 * NTF-C1 §5/§44 — a recipient's identity inside one notification is
 * `(surface, userId)`, not `userId`. Every per-recipient map in this file is
 * keyed by this, because the same person can legitimately appear twice: once
 * as an Agency operator and once as a Client Area member. Keying by `userId`
 * alone would silently merge the two and give one of them the other's
 * delivery decisions.
 */
type RecipientKey = string;

function recipientKey(
  surface: NotificationRecipientSurface,
  userId: string,
): RecipientKey {
  return `${surface}|${userId}`;
}

/** An addressed recipient, after surface resolution. */
type SurfacedRecipient = NotificationExplicitRecipient & {
  surface: NotificationRecipientSurface;
};

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
    /**
     * NTF-C1 §8/§48 — the Client Area recipient/email resolver.
     *
     * A registry provided by this module, so it always resolves; `@Optional()`
     * covers only the specs that construct this service directly. The thing it
     * replaces was an `@Optional() @Inject(TOKEN)` bound in another module,
     * which is what made AP3's client channel fail silently for its whole
     * life — see the port's header and `ap3-client-notifier-wiring.spec.ts`.
     */
    @Optional()
    private readonly clientSurface?: ClientNotificationSurfaceRegistry,
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

    /**
     * §6 — the definition's audience bounds which surfaces may be addressed.
     * An event declared Agency-only cannot grow a client recipient by a
     * publisher's mistake, and vice versa. Fail-closed: anything the audience
     * does not permit is dropped here, before it can reach a delivery.
     */
    const agencyRecipients: SurfacedRecipient[] = this.audienceAllows(
      definition.audience,
      NotificationRecipientSurface.AGENCY,
    )
      ? resolvedRecipients
          .filter(
            (recipient) =>
              (recipient.surface ?? NotificationRecipientSurface.AGENCY) ===
              NotificationRecipientSurface.AGENCY,
          )
          .map((recipient) => ({
            ...recipient,
            surface: NotificationRecipientSurface.AGENCY,
          }))
      : [];

    // §8 — resolved live, against membership + role permission + module +
    // CRM eligibility, by the Client Area surface itself.
    const clientRecipients = await this.resolveClientRecipients(
      event,
      definition.audience,
    );

    const surfaced = [
      ...agencyRecipients,
      ...clientRecipients.map((recipient) => ({
        userId: recipient.userId,
        interestReason: event.clientAudience!.interestReason,
        surface: NotificationRecipientSurface.CLIENT_AREA,
      })),
    ];

    // §42 — the actor is never notified, on either surface. Applied after the
    // two audiences are merged so one rule covers both.
    const recipients = this.selfNotificationPolicy.apply(
      event,
      surfaced,
      definition.selfNotificationPolicy,
    ) as SurfacedRecipient[];

    if (recipients.length === 0) {
      return {
        status: 'skipped',
        reason: 'no_recipients',
        recipientCount: 0,
      };
    }

    const agencyUserIds = recipients
      .filter(
        (recipient) => recipient.surface === NotificationRecipientSurface.AGENCY,
      )
      .map((recipient) => recipient.userId);
    const clientEmailByUserId = new Map(
      clientRecipients
        .filter((recipient) => recipient.email)
        .map((recipient) => [recipient.userId, recipient.email!]),
    );
    const requestedChannels = this.requestedChannels(event);
    const wantsChannel = (channel: NotificationDeliveryChannel) =>
      requestedChannels === null || requestedChannels.has(channel);

    const [agencyInApp, agencyEmail, agencyPush] = await Promise.all([
      wantsChannel(NotificationDeliveryChannel.IN_APP)
        ? this.resolveInAppRecipients(event, agencyUserIds)
        : Promise.resolve(new Set<string>()),
      wantsChannel(NotificationDeliveryChannel.EMAIL)
        ? this.resolveEmailRecipients(event, definition.moduleKey, agencyUserIds)
        : Promise.resolve(new Map<string, string>()),
      wantsChannel(NotificationDeliveryChannel.PUSH)
        ? this.resolvePushRecipients(event, definition.moduleKey, agencyUserIds)
        : Promise.resolve(new Set<string>()),
    ]);

    /**
     * §33 — the Client Area channel defaults, which differ from Agency's on
     * purpose:
     *
     *   in_app   on   — the feed is the surface's own baseline
     *   email    on   — AP3 already mailed these events unconditionally, and
     *                   §33 forbids silently switching that off while
     *                   migrating the pipeline
     *   push     opt-in by subscription — no subscription, no push, which is
     *                   how the Push API already works
     *
     * Agency preferences are deliberately not consulted for a client
     * recipient: they are a different person's settings for a different
     * surface (§32).
     */
    const inAppRecipients = new Set<RecipientKey>([
      ...[...agencyInApp].map((userId) =>
        recipientKey(NotificationRecipientSurface.AGENCY, userId),
      ),
      ...(wantsChannel(NotificationDeliveryChannel.IN_APP)
        ? clientRecipients.map((recipient) =>
            recipientKey(
              NotificationRecipientSurface.CLIENT_AREA,
              recipient.userId,
            ),
          )
        : []),
    ]);

    const emailRecipients = new Map<RecipientKey, string>([
      ...[...agencyEmail].map(
        ([userId, email]) =>
          [
            recipientKey(NotificationRecipientSurface.AGENCY, userId),
            email,
          ] as const,
      ),
      ...(wantsChannel(NotificationDeliveryChannel.EMAIL)
        ? [...clientEmailByUserId].map(
            ([userId, email]) =>
              [
                recipientKey(NotificationRecipientSurface.CLIENT_AREA, userId),
                email,
              ] as const,
          )
        : []),
    ]);

    const pushRecipients = new Set<RecipientKey>([
      ...[...agencyPush].map((userId) =>
        recipientKey(NotificationRecipientSurface.AGENCY, userId),
      ),
      ...(wantsChannel(NotificationDeliveryChannel.PUSH)
        ? clientRecipients.map((recipient) =>
            recipientKey(
              NotificationRecipientSurface.CLIENT_AREA,
              recipient.userId,
            ),
          )
        : []),
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
            // §4/§7 — written explicitly from the resolved audience.
            recipientSurface: recipient.surface,
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
          const key = recipientKey(
            recipient.recipientSurface,
            recipient.userId,
          );

          if (inAppRecipients.has(key)) {
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

          if (emailRecipients.has(key)) {
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

          if (pushRecipients.has(key)) {
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

        const emailDeliveries = savedDeliveries
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
              email: emailRecipients.get(
                recipientKey(recipient!.recipientSurface, recipient!.userId),
              )!,
              surface: recipient!.recipientSurface,
            };
          });

        const pendingEmailDeliveries = emailDeliveries.filter(
          (delivery) =>
            delivery.surface === NotificationRecipientSurface.AGENCY,
        );
        const pendingClientEmailDeliveries = emailDeliveries.filter(
          (delivery) =>
            delivery.surface === NotificationRecipientSurface.CLIENT_AREA,
        );

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
              // §25 — the fan-out must only reach subscriptions of this
              // recipient's own surface.
              surface: recipient!.recipientSurface,
            };
          });

        return {
          status: 'created',
          notificationId: savedNotification.id,
          recipientCount: savedRecipients.length,
          pendingEmailDeliveries,
          pendingClientEmailDeliveries,
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

      if (result.pendingClientEmailDeliveries.length > 0) {
        await this.sendEmailDeliveries(
          event,
          result.pendingClientEmailDeliveries,
          NotificationRecipientSurface.CLIENT_AREA,
        );
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

  /**
   * §6 — does this definition permit addressing that surface at all?
   *
   * An absent `audience` resolves to `AGENCY` rather than to "deny
   * everything". `define()` in the catalog always sets it, but a definition
   * constructed directly — a test double, or a module that builds one by hand
   * — would otherwise have every one of its Agency recipients silently
   * dropped. Defaulting the *field* is what §6 means by "existing definitions
   * keep their behaviour with no manual change"; the fail-closed direction
   * that matters is that nothing reaches the client surface without saying so,
   * and that still holds.
   */
  private audienceAllows(
    audience: NotificationAudience | undefined,
    surface: NotificationRecipientSurface,
  ): boolean {
    const effective = audience ?? NotificationAudience.AGENCY;
    if (effective === NotificationAudience.BOTH) return true;
    return surface === NotificationRecipientSurface.AGENCY
      ? effective === NotificationAudience.AGENCY
      : effective === NotificationAudience.CLIENT_AREA;
  }

  /**
   * §8 — the Client Area audience, resolved live through the surface port.
   *
   * Three independent conditions must all hold, and each is a reason to
   * resolve nothing rather than to guess:
   *
   *   the definition permits the client surface   (§6, fail-closed)
   *   the event carries a client audience query   (no query, no audience)
   *   the Client Area surface is wired            (§48, observable)
   *
   * The third is the one AP3 got wrong. When the surface is missing this logs
   * at `error` for an event whose audience is *only* the Client Area, because
   * that is a notification nobody will ever receive — exactly the silent
   * disappearance NTF-C1 exists to remove. It is not thrown: a notification
   * problem must not roll back the domain transition that caused it.
   */
  private async resolveClientRecipients(
    event: NotificationSourceEvent,
    audience: NotificationAudience,
  ): Promise<ClientNotificationRecipient[]> {
    if (!this.audienceAllows(audience, NotificationRecipientSurface.CLIENT_AREA)) {
      return [];
    }

    const query = event.clientAudience;
    if (!query) return [];

    if (!event.workspaceId) {
      this.logger.error(
        `Client notification ${event.eventType} has no workspaceId; no client recipient can be resolved.`,
      );
      return [];
    }

    const surface = this.clientSurface?.get();
    if (!surface) {
      this.logger.error(
        `Client Area notification surface is not wired; ${event.eventType} reached no client recipient.`,
      );
      return [];
    }

    try {
      return await surface.resolveAudience({
        tenantId: event.tenantId,
        workspaceId: event.workspaceId,
        companyContextId: query.companyContextId,
        requiredPermission: query.requiredPermission,
        requiredModule: query.requiredModule,
      });
    } catch (error) {
      this.logger.error(
        `Failed to resolve client recipients for ${event.eventType}`,
        error instanceof Error ? error.stack : String(error),
      );
      return [];
    }
  }

  private async resolveEmailRecipients(
    event: NotificationSourceEvent,
    moduleKey: string,
    recipientUserIds: string[],
  ): Promise<Map<string, string>> {
    // A client-only event has no Agency recipient; `In([])` would be invalid
    // SQL and the whole resolution is vacuous anyway.
    if (recipientUserIds.length === 0) return new Map<string, string>();

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
    if (recipientUserIds.length === 0) return new Set<string>();

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
    if (recipientUserIds.length === 0) return new Set<string>();

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

  /**
   * §50/§62 — one email path for both surfaces, so every client email is
   * recorded in `notification_deliveries` like every Agency one, and no client
   * delivery is invisible in a parallel ledger.
   *
   * Only the rendering differs, and only where it must: the CTA of a client
   * email has to land on a Client Area route (§16/§60). The renderer itself is
   * unchanged — rich email (branding, thumbnail CID) is explicitly NTF-C2.
   */
  private async sendEmailDeliveries(
    event: NotificationSourceEvent,
    pendingDeliveries: { deliveryId: string; email: string }[],
    surface: NotificationRecipientSurface = NotificationRecipientSurface.AGENCY,
  ) {
    const override = await this.getEmailTransportOverride(
      event.tenantId,
      event.workspaceId,
    );

    const isClient = surface === NotificationRecipientSurface.CLIENT_AREA;
    const title = isClient
      ? this.resolveClientTitle(event)
      : this.resolveTitle(event);
    const body = isClient
      ? this.resolveClientBody(event)
      : this.resolveBody(event);
    const frontendUrl =
      this.configService.get<string>('AGENCY_FRONTEND_URL') ??
      'http://localhost:3003';

    const { html, text } = isClient
      ? renderTransactionalEmail({
          title,
          intro: body,
          buttonLabel: 'Abrir Área do Cliente',
          buttonUrl: this.clientActionUrl(event),
        })
      : renderTransactionalEmail({
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

  /**
   * §25 — push fan-out is partitioned by surface.
   *
   * Two sends, not one, and the partition is the whole point: an operator who
   * is also a client has subscriptions of both surfaces under one `user_id`,
   * and a single `sendToUsers` call would deliver a client notification to the
   * browser they are logged into as Agency. The surface is passed down to the
   * subscription query rather than filtered afterwards, so nothing can reach
   * the wrong endpoint even transiently.
   */
  private async sendPushDeliveries(
    event: NotificationSourceEvent,
    pendingDeliveries: {
      deliveryId: string;
      userId: string;
      surface: NotificationRecipientSurface;
    }[],
  ) {
    for (const surface of [
      NotificationRecipientSurface.AGENCY,
      NotificationRecipientSurface.CLIENT_AREA,
    ]) {
      const forSurface = pendingDeliveries.filter(
        (pending) => pending.surface === surface,
      );
      if (forSurface.length > 0) {
        await this.sendPushDeliveriesForSurface(event, forSurface, surface);
      }
    }
  }

  private async sendPushDeliveriesForSurface(
    event: NotificationSourceEvent,
    pendingDeliveries: { deliveryId: string; userId: string }[],
    surface: NotificationRecipientSurface,
  ) {
    const isClient = surface === NotificationRecipientSurface.CLIENT_AREA;
    const title = isClient
      ? this.resolveClientTitle(event)
      : this.resolveTitle(event);
    const body = isClient
      ? this.resolveClientBody(event)
      : this.resolveBody(event);
    const frontendUrl =
      this.configService.get<string>('AGENCY_FRONTEND_URL') ??
      'http://localhost:3003';
    // §60 — a client push opens a Client Area route, never an Agency one.
    const actionUrl = isClient
      ? this.clientActionUrl(event)
      : this.optionalString(event.payload.actionUrl);

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
        surface,
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

  /**
   * §16/§60 — the absolute Client Area deep link of this event.
   *
   * Built from `clientAudience.actionUrl`, which the publisher supplies as a
   * Client Area route. Falls back to the surface root rather than to the
   * Agency app: a client who clicks through must never land on an Agency
   * route, and a dead-ends-at-home link is a better failure than one that
   * leaks internal structure.
   */
  private clientActionUrl(event: NotificationSourceEvent): string {
    const base = (
      this.configService.get<string>('CLIENT_AREA_FRONTEND_URL') ??
      this.configService.get<string>('AGENCY_FRONTEND_URL') ??
      'http://localhost:3003'
    ).replace(/\/$/, '');

    const route = event.clientAudience?.actionUrl;

    // Only a relative in-surface route is accepted; anything absolute could
    // point anywhere.
    if (typeof route === 'string' && route.startsWith('/client-area/')) {
      return `${base}${route}`;
    }

    return `${base}/client-area`;
  }

  private resolveClientTitle(event: NotificationSourceEvent): string {
    const title = event.clientAudience?.title;
    return typeof title === 'string' && title.trim()
      ? title.trim().slice(0, 180)
      : this.resolveTitle(event);
  }

  private resolveClientBody(event: NotificationSourceEvent): string {
    const body = event.clientAudience?.body;
    return typeof body === 'string' && body.trim()
      ? body.trim()
      : this.resolveBody(event);
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

  /**
   * NTF-C1 — the client projection's inputs live in metadata.
   *
   * One notification row can serve both audiences (`audience='both'`), so it
   * cannot have a single `action_url`: `notifications.action_url` keeps the
   * Agency route, and the client route travels here, where only the client
   * projection reads it. Same for the copy, when the two surfaces should word
   * it differently.
   *
   * `companyContextId` is recorded because a client may hold memberships in
   * several companies (§20) and the feed must say which one this belongs to.
   * Note that metadata is never exposed to the client as-is — the projection
   * reads these three keys and nothing else crosses (§43).
   */
  private resolveMetadata(
    event: NotificationSourceEvent,
  ): Record<string, unknown> {
    const metadata = event.payload.metadata;
    const base =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? { ...(metadata as Record<string, unknown>) }
        : {};

    const client = event.clientAudience;
    if (!client) return base;

    return {
      ...base,
      companyContextId: client.companyContextId,
      ...(client.actionUrl ? { clientActionUrl: client.actionUrl } : {}),
      ...(client.title ? { clientTitle: client.title } : {}),
      ...(client.body ? { clientBody: client.body } : {}),
    };
  }

  private optionalString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();

    return normalized || null;
  }
}
