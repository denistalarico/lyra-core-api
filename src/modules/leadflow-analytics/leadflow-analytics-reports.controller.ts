import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { ClientAreaExposed } from '../client-area/client-area.decorators';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PdfEngineUnavailableError } from '../document-layouts/document-pdf-renderer.service';
import {
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  CreateLeadFlowAnalyticsReportDto,
  PreviewLeadFlowAnalyticsReportDto,
} from './dto/leadflow-analytics-report.dto';
import { LEADFLOW_ANALYTICS_PERMISSIONS } from './leadflow-analytics.permissions';
import {
  LeadFlowAnalyticsSnapshotReportService,
  type RenderLeadFlowReportRequest,
} from './services/leadflow-analytics-snapshot-report.service';

/**
 * Report export and the Relatórios tab of the LeadFlow Analytics — AN-LF2.
 *
 * Replaces the legacy `POST leadflow/analytics/reports/pdf` (same path, the
 * snapshot body). Emitting a report is a read of numbers the caller already
 * sees, so it takes either LeadFlow read key; deleting an archived emission
 * removes a record of what was sent to a client and takes the full key.
 */
@Controller('leadflow/analytics/reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class LeadFlowAnalyticsReportsController {
  private readonly logger = new Logger(LeadFlowAnalyticsReportsController.name);

  constructor(
    private readonly service: LeadFlowAnalyticsSnapshotReportService,
  ) {}

  @ClientAreaExposed('analytics')
  @Get()
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  async list(@RequestContextData() ctx: RequestContext) {
    const items = await this.service.list(resolveCompanyAwareScope(ctx));

    return { items, total: items.length };
  }

  /** The preview overlay's content: the export's PDF, inline, never recorded. */
  @ClientAreaExposed('analytics')
  @Post('preview')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  async preview(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PreviewLeadFlowAnalyticsReportDto,
    @Res({ passthrough: false }) response: Response,
  ) {
    const report = await this.render(ctx, dto, { persist: false });

    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${report.filename}"`,
      'Cache-Control': 'no-store',
    });

    return response.send(report.buffer);
  }

  @ClientAreaExposed('analytics')
  @Post('pdf')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  async renderPdf(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateLeadFlowAnalyticsReportDto,
    @Res({ passthrough: false }) response: Response,
  ) {
    const report = await this.render(ctx, dto, { persist: true });

    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${report.filename}"`,
      'Cache-Control': 'no-store',
    });

    return response.send(report.buffer);
  }

  /** The original emitted bytes, never a re-render of today's dashboard. */
  @ClientAreaExposed('analytics')
  @Get(':id/file')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  async file(
    @RequestContextData() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('disposition') disposition: string | undefined,
    @Res({ passthrough: false }) response: Response,
  ) {
    const report = await this.service.getFile(
      resolveCompanyAwareScope(ctx),
      id,
    );
    const inline = disposition === 'inline';

    response.set({
      'Content-Type': report.contentType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${report.filename}"`,
      'Cache-Control': 'private, no-store',
    });
    report.body.pipe(response);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(LEADFLOW_ANALYTICS_PERMISSIONS.fullView)
  async remove(
    @RequestContextData() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.service.remove(resolveCompanyAwareScope(ctx), id);
  }

  private async render(
    ctx: RequestContext,
    dto: CreateLeadFlowAnalyticsReportDto,
    options: { persist: boolean },
  ) {
    try {
      return await this.service.renderPdf(ctx, this.toRequest(dto, options));
    } catch (error) {
      // An absent engine is an environment problem, not a bad request
      // (`project_pdf_playwright_path`): a 503 with a sentence tells the
      // operator to retry rather than to re-configure the report.
      if (error instanceof PdfEngineUnavailableError) {
        this.logger.error(
          `PDF engine unavailable while generating a LeadFlow Analytics report: ${
            error.cause instanceof Error
              ? error.cause.message
              : String(error.cause)
          }`,
        );

        throw new ServiceUnavailableException(
          'Não foi possível gerar o PDF no momento. Tente novamente em instantes.',
        );
      }

      throw error;
    }
  }

  private toRequest(
    dto: CreateLeadFlowAnalyticsReportDto,
    options: { persist: boolean },
  ): RenderLeadFlowReportRequest {
    return {
      title: dto.title,
      dashboardId: dto.dashboardId ?? null,
      channels: dto.channels,
      // A calendar day, kept as the `YYYY-MM-DD` string it arrived as.
      since: dto.since.slice(0, 10),
      until: dto.until.slice(0, 10),
      pageMode: dto.pageMode,
      orientation: dto.orientation ?? 'landscape',
      issuedTimezone: dto.issuedTimezone,
      snapshot: dto.snapshot,
      persist: options.persist,
    };
  }
}
