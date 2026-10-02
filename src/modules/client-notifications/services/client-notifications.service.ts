import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationRecipientEntity } from '../../notifications/entities';
import {
  NotificationDeliveryChannel,
  NotificationDeliveryStatus,
  NotificationRecipientSurface,
} from '../../notifications/enums';
import {
  companyContextIdOf,
  toClientNotificationItem,
  type ClientNotificationItem,
} from '../../notifications/services/client-notification.view';

const AGENCY_CONNECTION = 'agency';

/**
 * The identity a client notification query runs as. Produced by the Client
 * Area guard chain, never by anything a request supplies.
 */
export type ClientNotificationReader = {
  tenantId: string;
  userId: string;
};

export type ClientNotificationListResponse = {
  items: ClientNotificationItem[];
  nextCursor: string | null;
  hasMore: boolean;
};

/**
 * NTF-C1 §12/§13/§15 — the Client Area notification feed.
 *
 * READS THE SAME TABLES AS THE AGENCY FEED
 * ----------------------------------------
 * `notifications` + `notification_recipients`, filtered to
 * `recipient_surface='client_area'`. There is deliberately no
 * `client_notifications` table: one storage model, one unread definition, one
 * idempotency story. The feed differs from the Agency one in exactly two ways
 * — the surface predicate, and a projection built field by field (§43).
 *
 * WHY THE FEED IS NOT COMPANY-SCOPED
 * ----------------------------------
 * A person may hold memberships in several companies (§20), and the bell in
 * the shell is one bell. So the query is scoped by `(tenant, user, surface)`
 * and each item carries its own `companyContextId` for the deep link. Scoping
 * the *list* per company would mean a client with two companies had to open
 * each to discover they had been notified.
 *
 * The company is therefore not what authorizes reading a notification — the
 * recipient row is: it exists because the person was an eligible member when
 * the event was processed. Revoking a membership later does not retroactively
 * unsay what was already said (§21), and acting on it is what re-checks
 * access, in the module that owns the action.
 */
@Injectable()
export class ClientNotificationsService {
  constructor(
    @InjectRepository(NotificationRecipientEntity, AGENCY_CONNECTION)
    private readonly recipients: Repository<NotificationRecipientEntity>,
  ) {}

  async list(
    reader: ClientNotificationReader,
    options: { limit?: number; cursor?: string; unreadOnly?: boolean } = {},
  ): Promise<ClientNotificationListResponse> {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 50);

    const qb = this.baseQuery(reader)
      .leftJoinAndSelect('recipient.notification', 'notification')
      .orderBy('recipient.createdAt', 'DESC')
      .addOrderBy('recipient.id', 'DESC')
      .take(limit + 1);

    if (options.unreadOnly) {
      qb.andWhere('recipient.readAt IS NULL');
    }

    if (options.cursor) {
      const cursor = this.decodeCursor(options.cursor);
      if (cursor) {
        // Same `(createdAt, id)` key as the Agency feed: a strict timestamp
        // comparison alone would skip a row sharing the cursor's timestamp.
        qb.andWhere(
          `(
            recipient.created_at < :cursorCreatedAt
            OR (recipient.created_at = :cursorCreatedAt AND recipient.id < :cursorId)
          )`,
          { cursorCreatedAt: cursor.createdAt, cursorId: cursor.id },
        );
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);

    return {
      items: page.flatMap((recipient) => this.project(recipient)),
      nextCursor:
        hasMore && last
          ? this.encodeCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
      hasMore,
    };
  }

  /**
   * §30 — unread is `read_at IS NULL` on the recipient row, the same
   * definition the Agency bell uses. No separate counter column exists, so
   * nothing can disagree with the list.
   */
  async unreadCount(
    reader: ClientNotificationReader,
  ): Promise<{ count: number }> {
    const count = await this.baseQuery(reader)
      .andWhere('recipient.readAt IS NULL')
      .getCount();

    return { count };
  }

  async markSeen(
    reader: ClientNotificationReader,
    notificationId: string,
  ): Promise<ClientNotificationItem> {
    const recipient = await this.findOrFail(reader, notificationId);
    if (!recipient.seenAt) {
      recipient.seenAt = new Date();
      await this.recipients.save(recipient);
    }
    return this.projectOrFail(recipient);
  }

  /**
   * §31 — marking a notification read never touches the conversation
   * watermark. They answer different questions ("did I see the alert?" vs
   * "did I read the messages?"), and the conversation's own read endpoint is
   * the only writer of its watermark.
   */
  async markRead(
    reader: ClientNotificationReader,
    notificationId: string,
  ): Promise<ClientNotificationItem> {
    const recipient = await this.findOrFail(reader, notificationId);
    const now = new Date();
    recipient.seenAt ??= now;
    recipient.readAt ??= now;
    await this.recipients.save(recipient);
    return this.projectOrFail(recipient);
  }

  async archive(
    reader: ClientNotificationReader,
    notificationId: string,
  ): Promise<ClientNotificationItem> {
    const recipient = await this.findOrFail(reader, notificationId);
    const now = new Date();
    recipient.seenAt ??= now;
    recipient.readAt ??= now;
    recipient.archivedAt ??= now;
    await this.recipients.save(recipient);
    return this.projectOrFail(recipient);
  }

  async markAllRead(
    reader: ClientNotificationReader,
  ): Promise<{ updated: number }> {
    const result = await this.recipients
      .createQueryBuilder()
      .update(NotificationRecipientEntity)
      .set({
        seenAt: () => 'COALESCE(seen_at, now())',
        readAt: () => 'COALESCE(read_at, now())',
      })
      .where('user_id = :userId', { userId: reader.userId })
      // The surface predicate is repeated here because this UPDATE does not
      // go through `baseQuery`; without it, a client request would mark an
      // operator's Agency notifications read.
      .andWhere('recipient_surface = :surface', {
        surface: NotificationRecipientSurface.CLIENT_AREA,
      })
      .andWhere('read_at IS NULL')
      .andWhere('archived_at IS NULL')
      .andWhere(
        `notification_id IN (
          SELECT id FROM notifications WHERE tenant_id = :tenantId
        )`,
        { tenantId: reader.tenantId },
      )
      .execute();

    return { updated: result.affected ?? 0 };
  }

  /**
   * The ownership predicate of every read and every write above (§15).
   *
   * Three conditions, all required: the recipient row is this user's, on the
   * client surface, in this tenant. The in-app delivery join is what keeps the
   * feed consistent with the Agency one — a notification whose in-app channel
   * was not delivered is not in anybody's list.
   */
  private baseQuery(reader: ClientNotificationReader) {
    return this.recipients
      .createQueryBuilder('recipient')
      .innerJoin(
        'recipient.deliveries',
        'inAppDelivery',
        'inAppDelivery.channel = :inAppChannel AND inAppDelivery.status = :inAppStatus',
        {
          inAppChannel: NotificationDeliveryChannel.IN_APP,
          inAppStatus: NotificationDeliveryStatus.SENT,
        },
      )
      .innerJoin('recipient.notification', 'notificationScope')
      .where('recipient.userId = :userId', { userId: reader.userId })
      .andWhere('recipient.recipientSurface = :surface', {
        surface: NotificationRecipientSurface.CLIENT_AREA,
      })
      .andWhere('notificationScope.tenantId = :tenantId', {
        tenantId: reader.tenantId,
      })
      .andWhere('recipient.archivedAt IS NULL');
  }

  private async findOrFail(
    reader: ClientNotificationReader,
    notificationId: string,
  ): Promise<NotificationRecipientEntity> {
    const recipient = await this.baseQuery(reader)
      .leftJoinAndSelect('recipient.notification', 'notification')
      .andWhere('notificationScope.id = :notificationId', { notificationId })
      .getOne();

    // 404 and not 403: a client must not be able to tell an Agency
    // notification's id from a non-existent one.
    if (!recipient) throw new NotFoundException('Notification not found.');
    return recipient;
  }

  /**
   * A client recipient whose notification has no company in metadata cannot be
   * projected safely — the item would have no scope for its deep link — so it
   * is omitted from the feed rather than shown without one.
   */
  private project(
    recipient: NotificationRecipientEntity,
  ): ClientNotificationItem[] {
    const companyContextId = companyContextIdOf(recipient.notification);
    return companyContextId
      ? [toClientNotificationItem(recipient, companyContextId)]
      : [];
  }

  private projectOrFail(
    recipient: NotificationRecipientEntity,
  ): ClientNotificationItem {
    const companyContextId = companyContextIdOf(recipient.notification);
    if (!companyContextId) {
      throw new NotFoundException('Notification not found.');
    }
    return toClientNotificationItem(recipient, companyContextId);
  }

  private encodeCursor(payload: { createdAt: string; id: string }): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  private decodeCursor(
    cursor: string,
  ): { createdAt: string; id: string } | null {
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as { createdAt?: unknown; id?: unknown };
      return typeof parsed.createdAt === 'string' &&
        typeof parsed.id === 'string'
        ? { createdAt: parsed.createdAt, id: parsed.id }
        : null;
    } catch {
      // An opaque cursor that does not decode is treated as no cursor: the
      // caller gets the first page instead of an error.
      return null;
    }
  }
}
