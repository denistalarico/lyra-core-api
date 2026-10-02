import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Server } from 'socket.io';
import { Repository } from 'typeorm';
import {
  NotificationDeliveryChannel,
  NotificationDeliveryStatus,
  NotificationRecipientSurface,
} from '../enums';
import { NotificationRecipientEntity } from '../entities';
import {
  NotificationListItem,
  NotificationUnreadCountResponse,
} from '../types';
import {
  companyContextIdOf,
  toClientNotificationItem,
  type ClientNotificationItem,
} from './client-notification.view';
import { mapNotificationRecipientToListItem } from './notification-list-item.mapper';
import { NotificationsService } from './notifications.service';

type NotificationRealtimePayload = {
  notification: NotificationListItem;
  unreadCount: number;
};

@Injectable()
export class NotificationRealtimeService {
  private readonly logger = new Logger(NotificationRealtimeService.name);
  private server: Server | null = null;

  constructor(
    @InjectRepository(NotificationRecipientEntity, 'agency')
    private readonly recipientRepo: Repository<NotificationRecipientEntity>,
    private readonly notificationsService: NotificationsService,
  ) {}

  bindServer(server: Server): void {
    this.server = server;
  }

  static getUserRoom(input: {
    tenantId: string;
    workspaceId?: string | null;
    userId: string;
  }): string {
    return [
      'notifications',
      input.tenantId,
      input.workspaceId ?? 'none',
      input.userId,
    ].join(':');
  }

  /**
   * NTF-C1 §17/§56 — a client notification is emitted on the Client Area
   * namespace, through the gateway CCOM1 already built.
   *
   * Registered rather than injected, for the same reason as every other port
   * here: `NotificationsModule` cannot import the Client Area stack, and a
   * token bound elsewhere would inject as `undefined` (§48). A null emitter
   * means client realtime is simply not wired in this process; the
   * notification is still persisted and still shows up on the next fetch.
   */
  private clientEmitter:
    | ((input: {
        tenantId: string;
        companyContextId: string;
        userId: string;
        notification: ClientNotificationItem;
        unreadCount: number;
      }) => void)
    | null = null;

  registerClientEmitter(
    emitter: NonNullable<NotificationRealtimeService['clientEmitter']>,
  ): void {
    this.clientEmitter = emitter;
  }

  async emitCreatedForRecipient(recipientId: string): Promise<void> {
    // The Agency server may be unbound while the client one is wired, so the
    // early return has to be per surface, not global. It is re-checked below.
    if (!this.server && !this.clientEmitter) {
      return;
    }

    try {
      const recipient = await this.recipientRepo.findOne({
        where: { id: recipientId },
        relations: {
          notification: true,
          deliveries: true,
        },
      });

      if (!recipient?.notification) {
        return;
      }

      const hasSentInAppDelivery = recipient.deliveries?.some(
        (delivery) =>
          delivery.channel === NotificationDeliveryChannel.IN_APP &&
          delivery.status === NotificationDeliveryStatus.SENT,
      );

      if (!hasSentInAppDelivery) {
        return;
      }

      const context = {
        tenantId: recipient.notification.tenantId,
        workspaceId: recipient.notification.workspaceId,
        userId: recipient.userId,
        surface: recipient.recipientSurface,
      };
      const unreadCount = await this.notificationsService.unreadCount(context);

      /**
       * §17/§19 — the Client Area branch.
       *
       * Two things differ and nothing else: the transport (the CCOM1 client
       * namespace, never `/agency/notifications`) and the projection, which is
       * built client-safe field by field so no internal metadata, workspace id
       * or Agency actor id crosses the boundary (§43).
       */
      if (
        recipient.recipientSurface === NotificationRecipientSurface.CLIENT_AREA
      ) {
        const companyContextId = companyContextIdOf(recipient.notification);
        if (!companyContextId || !this.clientEmitter) {
          return;
        }

        this.clientEmitter({
          tenantId: context.tenantId,
          companyContextId,
          userId: recipient.userId,
          notification: toClientNotificationItem(recipient, companyContextId),
          unreadCount: unreadCount.count,
        });
        return;
      }

      if (!this.server) {
        return;
      }

      const notification = mapNotificationRecipientToListItem(recipient);
      const room = NotificationRealtimeService.getUserRoom(context);
      const payload: NotificationRealtimePayload = {
        notification,
        unreadCount: unreadCount.count,
      };

      this.server.to(room).emit('notification.created', payload);
      this.server.to(room).emit('notification.unread_count_updated', {
        count: unreadCount.count,
        byProduct: unreadCount.byProduct,
      } satisfies NotificationUnreadCountResponse);
    } catch (error) {
      this.logger.warn(
        `Failed to emit notification realtime event for recipient ${recipientId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
