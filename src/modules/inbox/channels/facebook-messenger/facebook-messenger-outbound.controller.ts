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
import { SendFacebookMessengerMediaDto } from './dto/send-facebook-messenger-media.dto';
import { SendFacebookMessengerTextDto } from './dto/send-facebook-messenger-text.dto';
import { FacebookMessengerOutboundService } from './services/facebook-messenger-outbound.service';

@Controller('inbox/channels/facebook-messenger')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class FacebookMessengerOutboundController {
  constructor(private readonly outbound: FacebookMessengerOutboundService) {}

  @Post('send-text')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.reply.assigned',
    'leadflow.inbox.conversation.reply.client',
  )
  async sendText(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: SendFacebookMessengerTextDto,
  ) {
    const result = await this.outbound.sendText({ ...dto, ctx });
    return this.response(result);
  }

  @Post('send-media')
  @RequireAnyPermission(
    'leadflow.inbox.conversation.reply.assigned',
    'leadflow.inbox.conversation.reply.client',
  )
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async sendMedia(
    @RequestContextData() ctx: RequestContext,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: SendFacebookMessengerMediaDto,
  ) {
    const result = await this.outbound.sendMedia({ ...dto, ctx, file });
    return this.response(result);
  }

  private response(
    result: Awaited<ReturnType<FacebookMessengerOutboundService['sendText']>>,
  ) {
    return {
      ok: true,
      conversationId: result.conversation.id,
      messageId: result.message.id,
      externalMessageId: result.message.externalMessageId,
      meta: { accepted: Boolean(result.message.externalMessageId) },
    };
  }
}
