import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { RequestContextData } from '../../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequireAnyPermission,
  RequireProductEntitlement,
} from '../../../permissions';
import { SendWhatsAppMediaDto } from './dto/send-whatsapp-media.dto';
import { SendWhatsAppTextDto } from './dto/send-whatsapp-text.dto';
import { WhatsAppOutboundService } from './services/whatsapp-outbound.service';

const WHATSAPP_MEDIA_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 },
};

@Controller('inbox/channels/whatsapp')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class WhatsAppOutboundController {
  constructor(
    private readonly whatsappOutboundService: WhatsAppOutboundService,
  ) {}

  @Post('send-text')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.reply.assigned',
    'leadflow.inbox.conversation.reply.client',
  )
  async sendText(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SendWhatsAppTextDto,
  ) {
    const result = await this.whatsappOutboundService.sendText({
      ctx,
      channelId: dto.channelId,
      conversationId: dto.conversationId,
      to: dto.to,
      text: dto.text,
      replyToMessageId: dto.replyToMessageId,
      idempotencyKey: dto.idempotencyKey,
    });

    return {
      ok: true,
      conversationId: result.conversation.id,
      messageId: result.message.id,
      externalMessageId: result.message.externalMessageId,
      meta: { accepted: Boolean(result.message.externalMessageId) },
    };
  }

  @Post('send-media')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.reply.assigned',
    'leadflow.inbox.conversation.reply.client',
  )
  @UseInterceptors(FileInterceptor('file', WHATSAPP_MEDIA_UPLOAD_OPTIONS))
  async sendMedia(
    @RequestContextData() ctx: RequestContext,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: SendWhatsAppMediaDto,
  ) {
    const result = await this.whatsappOutboundService.sendMedia({
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
      meta: { accepted: Boolean(result.message.externalMessageId) },
    };
  }
}
