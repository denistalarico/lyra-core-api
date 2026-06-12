import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PublishNotificationEventDto } from '../dto';
import { NotificationActorType } from '../enums';
import { NotificationEventProcessorService } from '../services';

@Controller('notifications/dev')
@UseGuards(JwtAuthGuard)
export class NotificationsDevController {
  constructor(
    private readonly configService: ConfigService,
    private readonly eventProcessor: NotificationEventProcessorService,
  ) {}

  @Post('events')
  processEvent(
    @RequestContextData() context: RequestContext,
    @Body() dto: PublishNotificationEventDto,
  ) {
    this.assertDevelopmentEnvironment();

    return this.eventProcessor.process({
      eventId: dto.eventId,
      eventType: dto.eventType,

      tenantId: context.tenantId,
      workspaceId: context.workspaceId ?? null,
      managedTenantId: dto.managedTenantId ?? null,

      productKey: dto.productKey,
      moduleKey: dto.moduleKey,

      actorType: dto.actorType,
      actorUserId:
        dto.actorUserId ??
        (dto.actorType === NotificationActorType.USER
          ? context.userId ?? null
          : null),
      initiatedByUserId: dto.initiatedByUserId ?? null,

      resourceType: dto.resourceType ?? null,
      resourceId: dto.resourceId ?? null,

      occurredAt: dto.occurredAt,

      recipients: dto.recipients,
      payload: dto.payload,
    });
  }

  private assertDevelopmentEnvironment(): void {
    const nodeEnv =
      this.configService.get<string>('NODE_ENV') ??
      process.env.NODE_ENV ??
      'development';

    if (nodeEnv === 'production') {
      throw new ForbiddenException(
        'Development notification endpoint is disabled in production.',
      );
    }
  }
}
