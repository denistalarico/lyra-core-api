import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  ListNotificationsQueryDto,
  ReadAllNotificationsDto,
  SubscribePushDto,
  UnsubscribePushDto,
} from '../dto';
import { NotificationPushService, NotificationsService } from '../services';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly notificationPushService: NotificationPushService,
  ) {}

  @Get('push/public-key')
  getPushPublicKey() {
    return { publicKey: this.notificationPushService.getPublicKey() };
  }

  @Post('push/subscribe')
  subscribePush(
    @RequestContextData() context: RequestContext,
    @Body() dto: SubscribePushDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.notificationPushService.subscribe(
      context.tenantId,
      context.userId!,
      dto.endpoint,
      dto.keys,
      userAgent,
    );
  }

  @Post('push/unsubscribe')
  unsubscribePush(
    @RequestContextData() context: RequestContext,
    @Body() dto: UnsubscribePushDto,
  ) {
    return this.notificationPushService.unsubscribe(
      context.tenantId,
      context.userId!,
      dto.endpoint,
    );
  }

  @Get()
  list(
    @RequestContextData() context: RequestContext,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notificationsService.list(
      this.toNotificationsContext(context),
      query,
    );
  }

  @Get('unread-count')
  unreadCount(@RequestContextData() context: RequestContext) {
    return this.notificationsService.unreadCount(
      this.toNotificationsContext(context),
    );
  }

  @Patch('read-all')
  markAllRead(
    @RequestContextData() context: RequestContext,
    @Body() dto: ReadAllNotificationsDto,
  ) {
    return this.notificationsService.markAllRead(
      this.toNotificationsContext(context),
      dto,
    );
  }

  @Get(':notificationId')
  findOne(
    @RequestContextData() context: RequestContext,
    @Param('notificationId') notificationId: string,
  ) {
    return this.notificationsService.findOne(
      this.toNotificationsContext(context),
      notificationId,
    );
  }

  @Patch(':notificationId/seen')
  markSeen(
    @RequestContextData() context: RequestContext,
    @Param('notificationId') notificationId: string,
  ) {
    return this.notificationsService.markSeen(
      this.toNotificationsContext(context),
      notificationId,
    );
  }

  @Patch(':notificationId/read')
  markRead(
    @RequestContextData() context: RequestContext,
    @Param('notificationId') notificationId: string,
  ) {
    return this.notificationsService.markRead(
      this.toNotificationsContext(context),
      notificationId,
    );
  }

  @Patch(':notificationId/archive')
  archive(
    @RequestContextData() context: RequestContext,
    @Param('notificationId') notificationId: string,
  ) {
    return this.notificationsService.archive(
      this.toNotificationsContext(context),
      notificationId,
    );
  }

  private toNotificationsContext(context: RequestContext) {
    return {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId ?? null,
      userId: context.userId!,
    };
  }
}
