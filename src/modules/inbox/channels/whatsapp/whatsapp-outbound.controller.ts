import { Body, Controller, Post } from '@nestjs/common';
import { SendWhatsAppTextDto } from './dto/send-whatsapp-text.dto';
import { WhatsAppOutboundService } from './services/whatsapp-outbound.service';

@Controller('inbox/channels/whatsapp')
export class WhatsAppOutboundController {
  constructor(
    private readonly whatsappOutboundService: WhatsAppOutboundService,
  ) {}

  @Post('send-text')
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
