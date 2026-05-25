import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/decorators/authenticated-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthTokenPayload } from '../auth/types/auth-token-payload.type';
import { UpdateDocumentLayoutDto } from './dto/document-layouts.dto';
import { DocumentLayoutsService } from './document-layouts.service';
import type { DocumentLayoutType } from './entities/document-layout.entities';

@Controller('agency/document-layouts')
@UseGuards(JwtAuthGuard)
export class DocumentLayoutsController {
  constructor(private readonly documentLayoutsService: DocumentLayoutsService) {}

  @Get('default')
  getDefaultLayout(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
  ) {
    return this.documentLayoutsService.getDefaultLayout(
      this.documentLayoutsService.getContext(user, workspaceId),
    );
  }

  @Patch('default')
  updateDefaultLayout(
    @AuthenticatedUser() user: AuthTokenPayload,
    @Headers('x-workspace-id') workspaceId: string | undefined,
    @Body() body: UpdateDocumentLayoutDto,
  ) {
    return this.documentLayoutsService.updateDefaultLayout(
      this.documentLayoutsService.getContext(user, workspaceId),
      body,
    );
  }

  @Get('templates')
  listTemplates(@Query('documentType') documentType?: string) {
    return this.documentLayoutsService.listTemplates(documentType ?? 'quote');
  }

  @Get('templates/:type/preview')
  getTemplatePreview(@Param('type') type: DocumentLayoutType) {
    return this.documentLayoutsService.getTemplatePreview(type);
  }
}
