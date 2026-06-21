import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../../common/context/request-context.decorator';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../../permissions';
import { TestInboundMessageDto } from './dto/test-inbound-message.dto';
import { InboundMessageIngestionService } from './services/inbound-message-ingestion.service';

@Controller('inbox/channels')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class InboxChannelsController {
  constructor(
    private readonly inboundIngestionService: InboundMessageIngestionService,
  ) {}

  @Post('test-inbound')
  @RequirePermission('leadflow.channels.channel.update.admin')
  async testInbound(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: TestInboundMessageDto,
  ) {
    const { tenantId, workspaceId } = ctx;

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
