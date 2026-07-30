import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PdfEngineUnavailableError } from '../document-layouts/document-pdf-renderer.service';
import {
  PermissionsGuard,
  RequireAnyPermission,
  RequireProductEntitlement,
} from '../permissions';
import { CreateAnalyticsReportDto } from './dto/create-analytics-report.dto';
import { GetCommercialJourneyAnalyticsDto } from './dto/get-commercial-journey-analytics.dto';
import { GetOperationalAnalyticsDto } from './dto/get-operational-analytics.dto';
import { LEADFLOW_ANALYTICS_PERMISSIONS } from './leadflow-analytics.permissions';
import { LeadFlowAnalyticsReportService } from './services/leadflow-analytics-report.service';
import { LeadFlowAnalyticsService } from './services/leadflow-analytics.service';
import { LeadFlowOperationalAnalyticsService } from './services/leadflow-operational-analytics.service';

@Controller('leadflow/analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequireProductEntitlement('leadflow')
export class LeadFlowAnalyticsController {
  private readonly logger = new Logger(LeadFlowAnalyticsController.name);

  constructor(
    private readonly analytics: LeadFlowAnalyticsService,
    private readonly operationalAnalytics: LeadFlowOperationalAnalyticsService,
    private readonly reports: LeadFlowAnalyticsReportService,
  ) {}

  @Get('commercial-journey')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  getCommercialJourney(
    @RequestContextData() ctx: RequestContext,
    @Query() query: GetCommercialJourneyAnalyticsDto,
  ) {
    return this.analytics.getCommercialJourney(ctx, query);
  }

  @Get('operational-overview')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  getOperationalOverview(
    @RequestContextData() ctx: RequestContext,
    @Query() query: GetOperationalAnalyticsDto,
  ) {
    return this.operationalAnalytics.getOverview(ctx, query);
  }

  @Post('reports/pdf')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  async renderReportPdf(
    @RequestContextData() ctx: RequestContext,
    @Body() query: CreateAnalyticsReportDto,
    @Res({ passthrough: false }) response: Response,
  ) {
    try {
      const report = await this.reports.renderPdf(ctx, query);
      response.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${report.filename}"`,
        'Cache-Control': 'no-store',
      });
      return response.send(report.buffer);
    } catch (error) {
      if (error instanceof PdfEngineUnavailableError) {
        this.logger.error(
          `PDF engine unavailable while generating LeadFlow Analytics report: ${
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
}
