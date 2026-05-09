import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { MAX_IMAGE_UPLOAD_BYTES } from '../../common/files/files.service';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateWebchatAdminMessageDto } from './dto/create-webchat-admin-message.dto';
import { CreateWebchatWidgetDto } from './dto/create-webchat-widget.dto';
import { PatchWebchatWidgetDto } from './dto/patch-webchat-widget.dto';
import { WebchatService } from './webchat.service';

type ListWidgetConversationsQuery = {
  status?: string;
  limit?: string;
  offset?: string;
};

const IMAGE_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
  },
  fileFilter: (
    _request: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    const allowedMimeTypes = new Set([
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
    ]);

    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new BadRequestException('Unsupported image format.'), false);
      return;
    }

    callback(null, true);
  },
};

@Controller('webchat')
@UseGuards(JwtAuthGuard)
export class WebchatController {
  constructor(private readonly webchatService: WebchatService) {}

  @Get('widgets')
  listWidgets(@RequestContextData() ctx: RequestContext) {
    return this.webchatService.listWidgets(ctx);
  }

  @Post('widgets')
  createWidget(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateWebchatWidgetDto,
  ) {
    return this.webchatService.createWidget(ctx, dto);
  }

  @Get('widgets/:widgetId')
  getWidget(
    @RequestContextData() ctx: RequestContext,
    @Param('widgetId') widgetId: string,
  ) {
    return this.webchatService.getWidget(ctx, widgetId);
  }

  @Patch('widgets/:widgetId')
  patchWidget(
    @RequestContextData() ctx: RequestContext,
    @Param('widgetId') widgetId: string,
    @Body() dto: PatchWebchatWidgetDto,
  ) {
    return this.webchatService.patchWidget(ctx, widgetId, dto);
  }

  @Post('widgets/:widgetId/activate')
  activateWidget(
    @RequestContextData() ctx: RequestContext,
    @Param('widgetId') widgetId: string,
  ) {
    return this.webchatService.activateWidget(ctx, widgetId);
  }

  @Post('widgets/:widgetId/deactivate')
  deactivateWidget(
    @RequestContextData() ctx: RequestContext,
    @Param('widgetId') widgetId: string,
  ) {
    return this.webchatService.deactivateWidget(ctx, widgetId);
  }

  @Delete('widgets/:widgetId')
  deleteWidget(
    @RequestContextData() ctx: RequestContext,
    @Param('widgetId') widgetId: string,
  ) {
    return this.webchatService.deleteWidget(ctx, widgetId);
  }

  @Post('widgets/:widgetId/avatar')
  @UseInterceptors(FileInterceptor('file', IMAGE_UPLOAD_OPTIONS))
  uploadWidgetAvatar(
    @RequestContextData() ctx: RequestContext,
    @Param('widgetId') widgetId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Missing multipart field "file".');
    }

    return this.webchatService.uploadWidgetAvatar(ctx, widgetId, file);
  }

  @Get('widgets/:widgetId/conversations')
  listWidgetConversations(
    @RequestContextData() ctx: RequestContext,
    @Param('widgetId') widgetId: string,
    @Query() query: ListWidgetConversationsQuery,
  ) {
    return this.webchatService.listWidgetConversations(ctx, widgetId, query);
  }

  @Get('conversations/:conversationId')
  getConversation(
    @RequestContextData() ctx: RequestContext,
    @Param('conversationId') conversationId: string,
  ) {
    return this.webchatService.getConversation(ctx, conversationId);
  }

  @Get('conversations/:conversationId/messages')
  listConversationMessages(
    @RequestContextData() ctx: RequestContext,
    @Param('conversationId') conversationId: string,
  ) {
    return this.webchatService.listConversationMessages(ctx, conversationId);
  }

  @Post('conversations/:conversationId/messages')
  createAdminMessage(
    @RequestContextData() ctx: RequestContext,
    @Param('conversationId') conversationId: string,
    @Body() dto: CreateWebchatAdminMessageDto,
  ) {
    return this.webchatService.createAdminMessage(ctx, conversationId, dto);
  }

  @Post('conversations/:conversationId/close')
  closeConversation(
    @RequestContextData() ctx: RequestContext,
    @Param('conversationId') conversationId: string,
  ) {
    return this.webchatService.closeConversation(ctx, conversationId);
  }
}
