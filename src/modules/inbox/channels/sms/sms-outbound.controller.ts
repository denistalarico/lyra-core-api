import {
  Body,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RequestContextData } from '../../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ClientAreaExposed } from '../../../client-area/client-area.decorators';
import { assertClientAreaMediaIntent } from '../../../leadflow-client-area/leadflow-client-media-intent';
import {
  PermissionsGuard,
  RequireAnyPermission,
  RequireProductEntitlement,
} from '../../../permissions';
import { SendSmsMediaDto, SendSmsTextDto } from './dto/sms.dto';
import { SMS_MMS_MAX_BYTES, SmsOutboundService } from './sms-outbound.service';

const SMS_MEDIA_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  // A little headroom so the service, not multer, explains the 1 MB limit.
  limits: { fileSize: SMS_MMS_MAX_BYTES * 2 },
};

@Controller('inbox/channels/sms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class SmsOutboundController {
  constructor(private readonly smsOutbound: SmsOutboundService) {}

  @ClientAreaExposed('leadflow_inbox')
  @Post('send-text')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.reply.assigned',
    'leadflow.inbox.conversation.reply.client',
  )
  async sendText(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SendSmsTextDto,
  ) {
    const result = await this.smsOutbound.sendText({
      ctx,
      channelId: dto.channelId,
      conversationId: dto.conversationId,
      to: dto.to,
      text: dto.text,
      idempotencyKey: dto.idempotencyKey,
    });
    return {
      ok: true,
      conversationId: result.conversation.id,
      messageId: result.message.id,
      externalMessageId: result.message.externalMessageId,
    };
  }

  @ClientAreaExposed('leadflow_inbox')
  @Post('send-media')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.reply.assigned',
    'leadflow.inbox.conversation.reply.client',
  )
  @UseInterceptors(FileInterceptor('file', SMS_MEDIA_UPLOAD_OPTIONS))
  async sendMedia(
    @RequestContextData() ctx: RequestContext,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: SendSmsMediaDto,
    @Query('conversationId') guardedConversationId?: string,
    @Query('channelId') guardedChannelId?: string,
    @Query('to') guardedTo?: string,
  ) {
    assertClientAreaMediaIntent(
      ctx,
      dto,
      guardedConversationId,
      guardedChannelId,
      guardedTo,
    );
    const result = await this.smsOutbound.sendMedia({
      ctx,
      channelId: dto.channelId,
      conversationId: dto.conversationId,
      to: dto.to,
      caption: dto.caption,
      idempotencyKey: dto.idempotencyKey,
      file,
    });
    return {
      ok: true,
      conversationId: result.conversation.id,
      messageId: result.message.id,
      externalMessageId: result.message.externalMessageId,
    };
  }
}
