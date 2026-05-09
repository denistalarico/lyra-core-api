import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CreatePublicWebchatConversationDto } from './dto/create-public-webchat-conversation.dto';
import { CreatePublicWebchatMessageDto } from './dto/create-public-webchat-message.dto';
import { CreatePublicWebchatVisitorDto } from './dto/create-public-webchat-visitor.dto';
import { WebchatService } from './webchat.service';

@Controller('public/webchat')
export class PublicWebchatController {
  constructor(private readonly webchatService: WebchatService) {}

  @Get('widgets/:publicKey/config')
  getConfig(
    @Param('publicKey') publicKey: string,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    return this.webchatService.getPublicWidgetConfig(
      publicKey,
      origin ?? referer,
    );
  }

  @Post('widgets/:publicKey/visitors')
  createVisitor(
    @Param('publicKey') publicKey: string,
    @Body() dto: CreatePublicWebchatVisitorDto,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.webchatService.createPublicVisitor(
      publicKey,
      dto,
      origin ?? referer,
      userAgent,
    );
  }

  @Post('widgets/:publicKey/conversations')
  createConversation(
    @Param('publicKey') publicKey: string,
    @Body() dto: CreatePublicWebchatConversationDto,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    return this.webchatService.createPublicConversation(
      publicKey,
      dto,
      origin ?? referer,
    );
  }

  @Post('conversations/:conversationId/messages')
  createMessage(
    @Param('conversationId') conversationId: string,
    @Body() dto: CreatePublicWebchatMessageDto,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    return this.webchatService.createPublicMessage(
      conversationId,
      dto,
      origin ?? referer,
    );
  }

  @Get('conversations/:conversationId/messages')
  listMessages(
    @Param('conversationId') conversationId: string,
    @Query('visitorId') visitorId?: string,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
  ) {
    return this.webchatService.listPublicMessages(
      conversationId,
      visitorId,
      origin ?? referer,
    );
  }
}
