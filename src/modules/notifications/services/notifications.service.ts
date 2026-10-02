import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository, SelectQueryBuilder } from 'typeorm';
import { ListNotificationsQueryDto } from '../dto';
import { NotificationEntity, NotificationRecipientEntity } from '../entities';
import {
  NotificationActionType,
  NotificationDeliveryChannel,
  NotificationDeliveryStatus,
  NotificationProductKey,
  NotificationRecipientSurface,
} from '../enums';
import {
  NotificationListItem,
  NotificationListResponse,
  NotificationUnreadCountResponse,
} from '../types';
import { mapNotificationRecipientToListItem } from './notification-list-item.mapper';

type NotificationsContext = {
  tenantId: string;
  workspaceId?: string | null;
  userId: string;
  /**
   * NTF-C1 §15/§44 — which surface's feed this is.
   *
   * Defaults to `AGENCY`, so every existing Agency caller keeps exactly the
   * rows it has today. It is not optional in effect, only in syntax: every
   * query below filters on it, because `user_id` alone no longer identifies a
   * feed. Without this filter, an operator who is also a member of a Company
   * would find their client notifications mixed into the Agency bell — the
   * same identity, two roles, one list.
   */
  surface?: NotificationRecipientSurface;
};

type CursorPayload = {
  createdAt: string;
  recipientId: string;
};

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationEntity, 'agency')
    private readonly notificationRepo: Repository<NotificationEntity>,

    @InjectRepository(NotificationRecipientEntity, 'agency')
    private readonly recipientRepo: Repository<NotificationRecipientEntity>,
  ) {}

  async list(
    context: NotificationsContext,
    query: ListNotificationsQueryDto,
  ): Promise<NotificationListResponse> {
    this.validateContext(context);

    const limit = query.limit ?? 30;

    const qb = this.createUserQuery(context)
      .leftJoinAndSelect('recipient.notification', 'notification')
      .orderBy('recipient.createdAt', 'DESC')
      .addOrderBy('recipient.id', 'DESC')
      .take(limit + 1);

    this.applyListFilters(qb, query);

    if (query.cursor) {
      const cursor = this.decodeCursor(query.cursor);

      qb.andWhere(
        new Brackets((cursorQb) => {
          cursorQb
            .where('recipient.createdAt < :cursorCreatedAt', {
              cursorCreatedAt: cursor.createdAt,
            })
            .orWhere(
              `(
                recipient.createdAt = :cursorCreatedAt
                AND recipient.id < :cursorRecipientId
              )`,
              {
                cursorCreatedAt: cursor.createdAt,
                cursorRecipientId: cursor.recipientId,
              },
            );
        }),
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const last = pageRows.at(-1);

    return {
      items: pageRows.map((recipient) =>
        mapNotificationRecipientToListItem(recipient),
      ),
      nextCursor:
        hasMore && last
          ? this.encodeCursor({
              createdAt: last.createdAt.toISOString(),
              recipientId: last.id,
            })
          : null,
      hasMore,
    };
  }

  async unreadCount(
    context: NotificationsContext,
    filters?: { moduleKey?: string; excludeModuleKey?: string },
  ): Promise<NotificationUnreadCountResponse> {
    this.validateContext(context);

    const query = this.createUserQuery(context)
      .leftJoin('recipient.notification', 'notification')
      .select('notification.productKey', 'productKey')
      .addSelect('COUNT(recipient.id)', 'count')
      .andWhere('recipient.readAt IS NULL')
      .andWhere('recipient.archivedAt IS NULL');

    if (filters?.moduleKey) {
      query.andWhere('notification.moduleKey = :countModuleKey', {
        countModuleKey: filters.moduleKey,
      });
    }

    if (filters?.excludeModuleKey) {
      query.andWhere('notification.moduleKey != :excludedCountModuleKey', {
        excludedCountModuleKey: filters.excludeModuleKey,
      });
    }

    const rows = await query.groupBy('notification.productKey').getRawMany<{
      productKey: NotificationProductKey;
      count: string;
    }>();

    const byProduct: Partial<Record<NotificationProductKey, number>> = {};

    let count = 0;

    for (const row of rows) {
      const productCount = Number(row.count);

      byProduct[row.productKey] = productCount;
      count += productCount;
    }

    return {
      count,
      byProduct,
    };
  }

  async findOne(
    context: NotificationsContext,
    notificationId: string,
  ): Promise<NotificationListItem> {
    this.validateContext(context);

    const recipient = await this.findRecipientOrFail(context, notificationId);

    return mapNotificationRecipientToListItem(recipient);
  }

  async markSeen(
    context: NotificationsContext,
    notificationId: string,
  ): Promise<NotificationListItem> {
    const recipient = await this.findRecipientOrFail(context, notificationId);

    if (!recipient.seenAt) {
      recipient.seenAt = new Date();
      await this.recipientRepo.save(recipient);
    }

    return mapNotificationRecipientToListItem(recipient);
  }

  async markRead(
    context: NotificationsContext,
    notificationId: string,
  ): Promise<NotificationListItem> {
    const recipient = await this.findRecipientOrFail(context, notificationId);

    const now = new Date();

    recipient.seenAt ??= now;
    recipient.readAt ??= now;

    await this.recipientRepo.save(recipient);

    return mapNotificationRecipientToListItem(recipient);
  }

  async markReadByResource(
    context: NotificationsContext,
    resource: {
      resourceType: string;
      resourceId: string;
      moduleKey?: string;
    },
  ): Promise<{ updated: number }> {
    this.validateContext(context);

    const qb = this.recipientRepo
      .createQueryBuilder()
      .update(NotificationRecipientEntity)
      .set({
        seenAt: () => 'COALESCE(seen_at, now())',
        readAt: () => 'COALESCE(read_at, now())',
      })
      .where('user_id = :userId', { userId: context.userId })
      // §15 — a bulk update must be scoped like a read; these two UPDATEs do
      // not go through `createUserQuery`, so the predicate is repeated rather
      // than assumed.
      .andWhere('recipient_surface = :recipientSurface', {
        recipientSurface:
          context.surface ?? NotificationRecipientSurface.AGENCY,
      })
      .andWhere('read_at IS NULL')
      .andWhere('archived_at IS NULL')
      .andWhere(
        `notification_id IN (
          SELECT id
          FROM notifications
          WHERE tenant_id = :tenantId
          AND (
            workspace_id IS NULL
            OR workspace_id = :workspaceId
          )
          AND resource_type = :resourceType
          AND resource_id = :resourceId
          ${resource.moduleKey ? 'AND module_key = :resourceModuleKey' : ''}
        )`,
        {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId ?? null,
          resourceType: resource.resourceType,
          resourceId: resource.resourceId,
          ...(resource.moduleKey
            ? { resourceModuleKey: resource.moduleKey }
            : {}),
        },
      );

    const result = await qb.execute();

    return { updated: result.affected ?? 0 };
  }

  async markAllRead(
    context: NotificationsContext,
    filters?: {
      productKey?: NotificationProductKey;
      moduleKey?: string;
      excludeModuleKey?: string;
    },
  ): Promise<{ updated: number }> {
    this.validateContext(context);

    const qb = this.recipientRepo
      .createQueryBuilder()
      .update(NotificationRecipientEntity)
      .set({
        seenAt: () => 'COALESCE(seen_at, now())',
        readAt: () => 'COALESCE(read_at, now())',
      })
      .where('user_id = :userId', {
        userId: context.userId,
      })
      // §15 — see `markReadByResource`.
      .andWhere('recipient_surface = :recipientSurface', {
        recipientSurface:
          context.surface ?? NotificationRecipientSurface.AGENCY,
      })
      .andWhere('read_at IS NULL')
      .andWhere('archived_at IS NULL')
      .andWhere(
        `notification_id IN (
          SELECT id
          FROM notifications
          WHERE tenant_id = :tenantId
          AND (
            workspace_id IS NULL
            OR workspace_id = :workspaceId
          )
        )`,
        {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId ?? null,
        },
      );

    if (filters?.productKey) {
      qb.andWhere(
        `notification_id IN (
          SELECT id
          FROM notifications
          WHERE product_key = :productKey
        )`,
        {
          productKey: filters.productKey,
        },
      );
    }

    if (filters?.moduleKey) {
      qb.andWhere(
        `notification_id IN (
          SELECT id
          FROM notifications
          WHERE module_key = :moduleKey
        )`,
        {
          moduleKey: filters.moduleKey,
        },
      );
    }

    if (filters?.excludeModuleKey) {
      qb.andWhere(
        `notification_id IN (
          SELECT id
          FROM notifications
          WHERE module_key != :excludeModuleKey
        )`,
        {
          excludeModuleKey: filters.excludeModuleKey,
        },
      );
    }

    const result = await qb.execute();

    return {
      updated: result.affected ?? 0,
    };
  }

  async archive(
    context: NotificationsContext,
    notificationId: string,
  ): Promise<NotificationListItem> {
    const recipient = await this.findRecipientOrFail(context, notificationId);

    const now = new Date();

    recipient.seenAt ??= now;
    recipient.readAt ??= now;
    recipient.archivedAt ??= now;

    await this.recipientRepo.save(recipient);

    return mapNotificationRecipientToListItem(recipient);
  }

  private createUserQuery(
    context: NotificationsContext,
  ): SelectQueryBuilder<NotificationRecipientEntity> {
    return this.recipientRepo
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
      .where('recipient.userId = :userId', {
        userId: context.userId,
      })
      // §15 — the surface is part of the ownership predicate, not a display
      // filter: a client user's query can never reach an Agency recipient row
      // and vice versa, including on `findOne`, `markRead` and `archive`,
      // which all build on this query.
      .andWhere('recipient.recipientSurface = :recipientSurface', {
        recipientSurface:
          context.surface ?? NotificationRecipientSurface.AGENCY,
      })
      .andWhere('notificationScope.tenantId = :tenantId', {
        tenantId: context.tenantId,
      })
      .andWhere(
        new Brackets((workspaceQb) => {
          workspaceQb
            .where('notificationScope.workspaceId IS NULL')
            .orWhere('notificationScope.workspaceId = :workspaceId', {
              workspaceId: context.workspaceId ?? null,
            });
        }),
      );
  }

  private applyListFilters(
    qb: SelectQueryBuilder<NotificationRecipientEntity>,
    query: ListNotificationsQueryDto,
  ): void {
    const status = query.status ?? 'all';

    if (status === 'unread') {
      qb.andWhere('recipient.readAt IS NULL');
      qb.andWhere('recipient.archivedAt IS NULL');
    }

    if (status === 'read') {
      qb.andWhere('recipient.readAt IS NOT NULL');
      qb.andWhere('recipient.archivedAt IS NULL');
    }

    if (status === 'archived') {
      qb.andWhere('recipient.archivedAt IS NOT NULL');
    }

    if (status === 'all') {
      qb.andWhere('recipient.archivedAt IS NULL');
    }

    if (query.productKey) {
      qb.andWhere('notification.productKey = :productKey', {
        productKey: query.productKey,
      });
    }

    if (query.moduleKey) {
      qb.andWhere('notification.moduleKey = :moduleKey', {
        moduleKey: query.moduleKey,
      });
    }

    if (query.excludeModuleKey) {
      qb.andWhere('notification.moduleKey != :excludeModuleKey', {
        excludeModuleKey: query.excludeModuleKey,
      });
    }

    if (query.priority) {
      qb.andWhere('notification.priority = :priority', {
        priority: query.priority,
      });
    }

    if (query.actionable === true) {
      qb.andWhere('notification.actionType != :noneAction', {
        noneAction: NotificationActionType.NONE,
      });
    }

    if (query.actionable === false) {
      qb.andWhere('notification.actionType = :noneAction', {
        noneAction: NotificationActionType.NONE,
      });
    }

    if (query.dateFrom) {
      qb.andWhere('notification.occurredAt >= :dateFrom', {
        dateFrom: query.dateFrom,
      });
    }

    if (query.dateTo) {
      qb.andWhere('notification.occurredAt <= :dateTo', {
        dateTo: query.dateTo,
      });
    }
  }

  private async findRecipientOrFail(
    context: NotificationsContext,
    notificationId: string,
  ): Promise<NotificationRecipientEntity> {
    this.validateContext(context);

    const recipient = await this.createUserQuery(context)
      .leftJoinAndSelect('recipient.notification', 'notification')
      .andWhere('notificationScope.id = :notificationId', {
        notificationId,
      })
      .getOne();

    if (!recipient) {
      throw new NotFoundException('Notification not found.');
    }

    return recipient;
  }

  private validateContext(context: NotificationsContext): void {
    if (!context.tenantId) {
      throw new BadRequestException('tenantId is required.');
    }

    if (!context.userId) {
      throw new BadRequestException('userId is required.');
    }
  }

  private encodeCursor(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  private decodeCursor(cursor: string): CursorPayload {
    try {
      const payload = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as Partial<CursorPayload>;

      if (
        !payload.createdAt ||
        !payload.recipientId ||
        Number.isNaN(new Date(payload.createdAt).getTime())
      ) {
        throw new Error('Invalid cursor payload.');
      }

      return {
        createdAt: payload.createdAt,
        recipientId: payload.recipientId,
      };
    } catch {
      throw new BadRequestException('Invalid notifications cursor.');
    }
  }
}
