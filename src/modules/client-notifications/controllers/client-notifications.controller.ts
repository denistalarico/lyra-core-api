import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { ClientAreaRequest } from '../../client-area/client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
} from '../../client-area/guards/client-area.guards';
import { NotificationPushService } from '../../notifications/services';
import { NotificationRecipientSurface } from '../../notifications/enums';
import {
  ClientNotificationPushSubscribeDto,
  ClientNotificationPushUnsubscribeDto,
  ListClientNotificationsQueryDto,
} from '../dto/client-notification.dto';
import { ClientNotificationsService } from '../services/client-notifications.service';

/**
 * NTF-C1 §13/§14 — the Client Area notification boundary.
 *
 * AUTHORIZATION: IDENTITY, NOT COMPANY
 * ------------------------------------
 *   ClientAreaEnabledGuard   surface flag; off ⇒ 404 for the whole surface
 *   ClientAreaAuthGuard      Client Area JWT (own secret + `typ='client_area'`)
 *                            + live session + not an Agency operator
 *
 * `ClientAreaMembershipGuard` is deliberately *not* here, and that is a
 * decision rather than an omission. The bell is one list across every company
 * a person belongs to (§20), so there is no single company in the path to
 * authorize against. What authorizes each row is the recipient record itself:
 * `(user_id = me, recipient_surface = 'client_area', tenant)` — see
 * `ClientNotificationsService.baseQuery`. A company-scoped route would have to
 * either take the company from the query string (which authorizes nothing) or
 * force the client to poll per company.
 *
 * An Agency JWT cannot reach any of this: the strategy uses
 * `JWT_CLIENT_AREA_ACCESS_SECRET` and requires `typ='client_area'`, which an
 * Agency token does not carry — the same structural isolation CCOM1 relies on,
 * not a filter that could be forgotten.
 *
 * ACTING on a notification is a different matter: following the deep link
 * lands on the approvals or conversations route, which runs the full
 * membership chain, so a revoked membership fails closed there (§21).
 */
@Controller('client-area/notifications')
@UseGuards(ClientAreaEnabledGuard, ClientAreaAuthGuard)
export class ClientNotificationsController {
  constructor(
    private readonly notifications: ClientNotificationsService,
    private readonly push: NotificationPushService,
  ) {}

  private reader(req: ClientAreaRequest) {
    const identity = req.clientAreaIdentity!;
    return { tenantId: identity.tenantId, userId: identity.userId };
  }

  @Get()
  list(
    @Req() req: ClientAreaRequest,
    @Query() query: ListClientNotificationsQueryDto,
  ) {
    return this.notifications.list(this.reader(req), {
      limit: query.limit,
      cursor: query.cursor,
      unreadOnly: query.status === 'unread',
    });
  }

  @Get('unread-count')
  unreadCount(@Req() req: ClientAreaRequest) {
    return this.notifications.unreadCount(this.reader(req));
  }

  /**
   * §26 — the same VAPID public key as the Agency surface. One key pair
   * identifies this server to the push provider; a second would add key
   * management without adding isolation, which comes from the subscription's
   * surface instead.
   */
  @Get('push/public-key')
  pushPublicKey() {
    return { publicKey: this.push.getPublicKey() };
  }

  /**
   * §24 — the surface is set server-side, always `client_area`. It is never
   * read from the body: a client-supplied surface would let this boundary
   * register an Agency subscription for the same identity.
   */
  @Post('push/subscribe')
  subscribePush(
    @Req() req: ClientAreaRequest,
    @Body() dto: ClientNotificationPushSubscribeDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    const reader = this.reader(req);
    return this.push.subscribe(
      reader.tenantId,
      reader.userId,
      dto.endpoint,
      dto.keys,
      userAgent,
      NotificationRecipientSurface.CLIENT_AREA,
    );
  }

  @Post('push/unsubscribe')
  unsubscribePush(
    @Req() req: ClientAreaRequest,
    @Body() dto: ClientNotificationPushUnsubscribeDto,
  ) {
    const reader = this.reader(req);
    return this.push.unsubscribe(
      reader.tenantId,
      reader.userId,
      dto.endpoint,
      NotificationRecipientSurface.CLIENT_AREA,
    );
  }

  @Post('read-all')
  markAllRead(@Req() req: ClientAreaRequest) {
    return this.notifications.markAllRead(this.reader(req));
  }

  @Post(':notificationId/seen')
  markSeen(
    @Req() req: ClientAreaRequest,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ) {
    return this.notifications.markSeen(this.reader(req), notificationId);
  }

  @Post(':notificationId/read')
  markRead(
    @Req() req: ClientAreaRequest,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ) {
    return this.notifications.markRead(this.reader(req), notificationId);
  }

  @Post(':notificationId/archive')
  archive(
    @Req() req: ClientAreaRequest,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ) {
    return this.notifications.archive(this.reader(req), notificationId);
  }
}
