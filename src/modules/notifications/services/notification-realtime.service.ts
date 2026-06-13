import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Server } from 'socket.io';
import { Repository } from 'typeorm';
import {
  NotificationDeliveryChannel,
  NotificationDeliveryStatus,
} from '../enums';
import { NotificationRecipientEntity } from '../entities';
import {
  NotificationListItem,
  NotificationUnreadCountResponse,
} from '../types';
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

  async emitCreatedForRecipient(recipientId: string): Promise<void> {
    if (!this.server) {
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
      };
      const notification = mapNotificationRecipientToListItem(recipient);
      const unreadCount =
        await this.notificationsService.unreadCount(context);
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
