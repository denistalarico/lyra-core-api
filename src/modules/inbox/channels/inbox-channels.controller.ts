import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
} from '@nestjs/common';
import { TestInboundMessageDto } from './dto/test-inbound-message.dto';
import { InboundMessageIngestionService } from './services/inbound-message-ingestion.service';

@Controller('inbox/channels')
export class InboxChannelsController {
  constructor(
    private readonly inboundIngestionService: InboundMessageIngestionService,
  ) {}

  @Post('test-inbound')
  async testInbound(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() dto: TestInboundMessageDto,
  ) {
    if (!tenantId || !workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    const result = await this.inboundIngestionService.ingest({
      tenantId,
      workspaceId,
      channelId: dto.channelId,
      channelType: dto.channelType,
      provider: dto.provider ?? null,
      externalThreadId: dto.externalThreadId,
      externalMessageId: dto.externalMessageId ?? null,
      sender: dto.sender,
      messageType: dto.messageType,
      content: dto.content,
      attachments: dto.attachments ?? [],
      occurredAt: new Date(),
      rawPayload: dto.rawPayload ?? {
        source: 'test-inbound-endpoint',
      },
      metadata: dto.metadata ?? {},
    });

    return {
      ok: true,
      conversationId: result.conversation.id,
      messageId: result.message.id,
    };
  }
}
