import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequireAnyPermission,
  RequireProductEntitlement,
} from '../../../permissions';
import { SendWhatsAppTextDto } from './dto/send-whatsapp-text.dto';
import { WhatsAppOutboundService } from './services/whatsapp-outbound.service';

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
  async sendText(@Body() dto: SendWhatsAppTextDto) {
    const result = await this.whatsappOutboundService.sendText({
      channelId: dto.channelId,
      conversationId: dto.conversationId,
      to: dto.to,
      text: dto.text,
    });

    return {
      ok: true,
      conversationId: result.conversation.id,
      messageId: result.message.id,
      externalMessageId: result.message.externalMessageId,
      meta: result.meta,
    };
  }
}
