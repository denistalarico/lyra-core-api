import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
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
  ApplyBriefingSuggestionRequestDto,
  ConfirmBriefingSuggestionsRequestDto,
  CreateBriefingSourceRequestDto,
  IngestBriefingPasteRequestDto,
  IngestBriefingUrlRequestDto,
} from './dto';
import { LEADFLOW_BRIEFING_PERMISSIONS } from './leadflow-briefing.permissions';
import { LeadFlowBriefingContentService } from './services/leadflow-briefing-content.service';
import { LeadFlowBriefingExtractionJobService } from './services/leadflow-briefing-extraction-job.service';
import { LeadFlowBriefingIngestionService } from './services/leadflow-briefing-ingestion.service';
import { LeadFlowBriefingSourceService } from './services/leadflow-briefing-source.service';
import { LeadFlowBriefingSuggestionService } from './services/leadflow-briefing-suggestion.service';

const BRIEFING_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
};

/**
 * Ingestion + review surface: upload/URL/paste sources (F4-002), read back
 * their stored content, list sources/jobs, trigger extraction (enqueues the
 * F4-003 worker's job), and review/apply/reject suggestions (F4-004).
 */
@Controller('leadflow/briefing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class LeadFlowBriefingController {
  constructor(
    private readonly sourceService: LeadFlowBriefingSourceService,
    private readonly ingestionService: LeadFlowBriefingIngestionService,
    private readonly contentService: LeadFlowBriefingContentService,
    private readonly jobService: LeadFlowBriefingExtractionJobService,
    private readonly suggestionService: LeadFlowBriefingSuggestionService,
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

  @Delete('sources/:sourceId')
  @HttpCode(204)
  @RequireAnyPermission(LEADFLOW_BRIEFING_PERMISSIONS.sourcesManage)
  async removeSource(
    @RequestContextData() ctx: RequestContext,
    @Param('sourceId') sourceId: string,
  ) {
    await this.sourceService.archiveSource(ctx, sourceId);
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

  @Get('settings/:settingsId/sources')
  @RequireAnyPermission(
    LEADFLOW_BRIEFING_PERMISSIONS.sourcesManage,
    LEADFLOW_BRIEFING_PERMISSIONS.suggestionsReview,
  )
  listSources(
    @RequestContextData() ctx: RequestContext,
    @Param('settingsId') settingsId: string,
  ) {
    return this.sourceService.listSources(ctx, settingsId);
  }

  @Get('settings/:settingsId/jobs')
  @RequireAnyPermission(
    LEADFLOW_BRIEFING_PERMISSIONS.jobsManage,
    LEADFLOW_BRIEFING_PERMISSIONS.suggestionsReview,
  )
  listJobs(
    @RequestContextData() ctx: RequestContext,
    @Param('settingsId') settingsId: string,
  ) {
    return this.jobService.listForSettings(ctx, settingsId);
  }

  @Post('sources/:sourceId/versions/:versionId/extract')
  @RequireAnyPermission(LEADFLOW_BRIEFING_PERMISSIONS.jobsManage)
  async extract(
    @RequestContextData() ctx: RequestContext,
    @Param('sourceId') sourceId: string,
    @Param('versionId') versionId: string,
  ) {
    const resolved = await this.sourceService.getAvailableVersionForExtraction(
      ctx,
      sourceId,
      versionId,
    );
    return this.jobService.enqueueJob(ctx, {
      settingsId: resolved.settingsId,
      sourceId: resolved.sourceId,
      sourceVersionId: resolved.versionId,
      createdById: ctx.userId ?? null,
    });
  }

  @Get('settings/:settingsId/review')
  @RequireAnyPermission(LEADFLOW_BRIEFING_PERMISSIONS.suggestionsReview)
  review(
    @RequestContextData() ctx: RequestContext,
    @Param('settingsId') settingsId: string,
  ) {
    return this.suggestionService.listForReview(ctx, settingsId);
  }

  @Post('suggestions/:suggestionId/apply')
  @RequireAnyPermission(LEADFLOW_BRIEFING_PERMISSIONS.suggestionsApply)
  applySuggestion(
    @RequestContextData() ctx: RequestContext,
    @Param('suggestionId') suggestionId: string,
    @Body() dto: ApplyBriefingSuggestionRequestDto,
  ) {
    if (!ctx.userId) throw new BadRequestException('User context is required.');
    return this.suggestionService.applySuggestion(ctx, {
      suggestionId,
      appliedById: ctx.userId,
      ...(dto?.value !== undefined ? { value: dto.value } : {}),
    });
  }

  @Post('settings/:settingsId/suggestions/confirm')
  @RequireAnyPermission(LEADFLOW_BRIEFING_PERMISSIONS.suggestionsApply)
  confirmSuggestions(
    @RequestContextData() ctx: RequestContext,
    @Param('settingsId') settingsId: string,
    @Body() dto: ConfirmBriefingSuggestionsRequestDto,
  ) {
    if (!ctx.userId) throw new BadRequestException('User context is required.');
    return this.suggestionService.confirmSuggestions(ctx, {
      settingsId,
      appliedById: ctx.userId,
      items: dto.items.map((item) => ({
        suggestionId: item.suggestionId,
        ...(item.value !== undefined ? { value: item.value } : {}),
      })),
    });
  }

  @Post('suggestions/:suggestionId/reject')
  @RequireAnyPermission(LEADFLOW_BRIEFING_PERMISSIONS.suggestionsReview)
  rejectSuggestion(
    @RequestContextData() ctx: RequestContext,
    @Param('suggestionId') suggestionId: string,
  ) {
    if (!ctx.userId) throw new BadRequestException('User context is required.');
    return this.suggestionService.rejectSuggestion(ctx, {
      suggestionId,
      decidedById: ctx.userId,
    });
  }
}
