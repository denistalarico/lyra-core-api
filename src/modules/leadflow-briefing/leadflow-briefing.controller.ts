import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequireAnyPermission, RequireProductEntitlement } from '../permissions';
import {
  CreateBriefingSourceRequestDto,
  IngestBriefingPasteRequestDto,
  IngestBriefingUrlRequestDto,
} from './dto';
import { LEADFLOW_BRIEFING_PERMISSIONS } from './leadflow-briefing.permissions';
import { LeadFlowBriefingContentService } from './services/leadflow-briefing-content.service';
import { LeadFlowBriefingIngestionService } from './services/leadflow-briefing-ingestion.service';
import { LeadFlowBriefingSourceService } from './services/leadflow-briefing-source.service';

const BRIEFING_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
};

/**
 * Ingestion surface for LF-RF-F4-002 — upload/URL/paste sources and read
 * back their stored content. No review/apply endpoints here (F4-004); no
 * content interpretation (F4-003).
 */
@Controller('leadflow/briefing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class LeadFlowBriefingController {
  constructor(
    private readonly sourceService: LeadFlowBriefingSourceService,
    private readonly ingestionService: LeadFlowBriefingIngestionService,
    private readonly contentService: LeadFlowBriefingContentService,
  ) {}

  @Post('sources')
  @RequireAnyPermission(LEADFLOW_BRIEFING_PERMISSIONS.sourcesManage)
  createSource(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateBriefingSourceRequestDto,
  ) {
    return this.sourceService.createSource(ctx, {
      settingsId: dto.settingsId,
      contextType: dto.contextType,
      agencyClientId: dto.agencyClientId ?? null,
      kind: dto.kind,
      label: dto.label,
      createdById: ctx.userId ?? null,
    });
  }

  @Post('sources/:sourceId/versions/upload')
  @RequireAnyPermission(LEADFLOW_BRIEFING_PERMISSIONS.sourcesManage)
  @UseInterceptors(FileInterceptor('file', BRIEFING_UPLOAD_OPTIONS))
  ingestUpload(
    @RequestContextData() ctx: RequestContext,
    @Param('sourceId') sourceId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.ingestionService.ingestUpload(ctx, sourceId, file);
  }

  @Post('sources/:sourceId/versions/url')
  @RequireAnyPermission(LEADFLOW_BRIEFING_PERMISSIONS.sourcesManage)
  ingestUrl(
    @RequestContextData() ctx: RequestContext,
    @Param('sourceId') sourceId: string,
    @Body() dto: IngestBriefingUrlRequestDto,
  ) {
    return this.ingestionService.ingestUrl(ctx, sourceId, dto.url);
  }

  @Post('sources/:sourceId/versions/paste')
  @RequireAnyPermission(LEADFLOW_BRIEFING_PERMISSIONS.sourcesManage)
  ingestPaste(
    @RequestContextData() ctx: RequestContext,
    @Param('sourceId') sourceId: string,
    @Body() dto: IngestBriefingPasteRequestDto,
  ) {
    return this.ingestionService.ingestPaste(ctx, sourceId, dto.text);
  }

  @Get('sources/:sourceId/versions/:versionId/content')
  @RequireAnyPermission(
    LEADFLOW_BRIEFING_PERMISSIONS.sourcesManage,
    LEADFLOW_BRIEFING_PERMISSIONS.provenanceView,
  )
  async content(
    @RequestContextData() ctx: RequestContext,
    @Param('sourceId') sourceId: string,
    @Param('versionId') versionId: string,
    @Res() response: Response,
  ) {
    const result = await this.contentService.getAuthorizedVersionContent(ctx, sourceId, versionId);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.kind === 'object') {
      response.setHeader('Content-Type', result.file.contentType);
      result.file.body.pipe(response);
      return;
    }
    response.setHeader('Content-Type', result.mimeType);
    response.send(result.text);
  }
}
