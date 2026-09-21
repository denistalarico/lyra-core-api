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
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { resolveCompanyAwareScope } from '../../common/context/company-aware-scope';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PdfEngineUnavailableError } from '../document-layouts/document-pdf-renderer.service';
import {
  PermissionsGuard,
  RequirePermission,
  RequireProductEntitlement,
} from '../permissions';
import {
  CreateSocialAnalyticsReportDto,
  PreviewSocialAnalyticsReportDto,
} from './dto/social-analytics-report.dto';
import {
  SocialAnalyticsReportService,
  type RenderReportRequest,
} from './services/social-analytics-report.service';

/**
 * Emitting a report is a read of numbers the caller can already see, rendered
 * onto paper — so it is governed by the report-viewing permission, not by the
 * one that reshapes a dashboard. Deleting an archived emission is different:
 * it removes a record of what was sent to a client, which is the kind of change
 * the manage permission exists for.
 */
const READ_PERMISSION = 'social.analytics.reports.view.operational';
const MANAGE_PERMISSION =
  'social.analytics.dashboards.manage.admin_or_explicit';

/**
 * Report export and the Relatórios tab — Etapa 9.
 *
 * A sibling of `social/analytics/dashboards` rather than a route under it: a
 * report outlives the dashboard it came from, and the archive is listed on its
 * own tab. Shares the module because it shares the scope resolution, the
 * permissions and the reports table.
 */
@Controller('social/analytics/reports')
export class SocialAnalyticsReportsController {
  private readonly logger = new Logger(SocialAnalyticsReportsController.name);

  constructor(private readonly service: SocialAnalyticsReportService) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(READ_PERMISSION)
  async list(@RequestContextData() ctx: RequestContext) {
    const items = await this.service.list(resolveCompanyAwareScope(ctx));

    return { items, total: items.length };
  }

  /**
   * The preview overlay's content.
   *
   * Returns HTML, not a PDF: the overlay shows the report in the page and the
   * browser's own print dialog handles "Imprimir", so rendering a PDF here
   * would spend a Playwright launch on a document the operator may well close.
   * Nothing is recorded — see the DTO.
   */
  @Post('preview')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(READ_PERMISSION)
  async preview(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: PreviewSocialAnalyticsReportDto,
  ) {
    const { html, title } = await this.service.renderHtml(
      ctx,
      this.toRequest(dto, { persist: false }),
    );

    return { html, title };
  }

  @Post('pdf')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(READ_PERMISSION)
  async renderPdf(
    @RequestContextData() ctx: RequestContext,
    @Body() dto: CreateSocialAnalyticsReportDto,
    @Res({ passthrough: false }) response: Response,
  ) {
    try {
      const report = await this.service.renderPdf(
        ctx,
        this.toRequest(dto, { persist: true }),
      );

      response.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${report.filename}"`,
        'Cache-Control': 'no-store',
      });

      return response.send(report.buffer);
    } catch (error) {
      // The engine being absent is an environment problem, not a bad request:
      // in production the Playwright chromium build lives in `/root/.cache`, so
      // a unit whose drop-in lacks `HOME=/root` and `ProtectHome=no` fails here
      // and nowhere else (`project_pdf_playwright_path`). A 503 with a sentence
      // is what tells the operator to retry rather than to re-configure their
      // report.
      if (error instanceof PdfEngineUnavailableError) {
        this.logger.error(
          `PDF engine unavailable while generating a Social Analytics report: ${
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

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequireProductEntitlement('social')
  @RequirePermission(MANAGE_PERMISSION)
  async remove(
    @RequestContextData() ctx: RequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.service.remove(resolveCompanyAwareScope(ctx), id);
  }

  private toRequest(
    dto: CreateSocialAnalyticsReportDto,
    options: { persist: boolean },
  ): RenderReportRequest {
    return {
      title: dto.title,
      dashboardId: dto.dashboardId ?? null,
      channels: dto.channels,
      // A calendar day, kept as the `YYYY-MM-DD` string it arrived as. Parsing
      // it into a Date would re-anchor it to the server's zone and can shift
      // the printed period by a day.
      since: dto.since.slice(0, 10),
      until: dto.until.slice(0, 10),
      pageMode: dto.pageMode,
      document: dto.document,
      persist: options.persist,
    };
  }
}
