import {
  Body,
  Controller,
  Get,
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
import { CreateAnalyticsReportDto } from './dto/create-analytics-report.dto';
import { DecideIntelligenceRecommendationDto } from './dto/decide-intelligence-recommendation.dto';
import { GenerateIntelligenceRecommendationsDto } from './dto/generate-intelligence-recommendations.dto';
import { GetCommercialJourneyAnalyticsDto } from './dto/get-commercial-journey-analytics.dto';
import { GetIntelligenceRecommendationsDto } from './dto/get-intelligence-recommendations.dto';
import { GetOperationalAnalyticsDto } from './dto/get-operational-analytics.dto';
import { LEADFLOW_ANALYTICS_PERMISSIONS } from './leadflow-analytics.permissions';
import { LeadFlowAnalyticsReportService } from './services/leadflow-analytics-report.service';
import { LeadFlowAnalyticsService } from './services/leadflow-analytics.service';
import { LeadFlowIntelligenceService } from './services/leadflow-intelligence.service';
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
    private readonly intelligence: LeadFlowIntelligenceService,
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

  @Get('recommendations')
  @RequireAnyPermission(
    LEADFLOW_ANALYTICS_PERMISSIONS.operationalView,
    LEADFLOW_ANALYTICS_PERMISSIONS.fullView,
  )
  getRecommendations(
    @RequestContextData() ctx: RequestContext,
    @Query() query: GetIntelligenceRecommendationsDto,
  ) {
    return this.intelligence.list(ctx, query);
  }

  @Post('recommendations/generate')
  @RequirePermission(LEADFLOW_ANALYTICS_PERMISSIONS.recommendationsManage)
  generateRecommendations(
    @RequestContextData() ctx: RequestContext,
    @Body() query: GenerateIntelligenceRecommendationsDto,
  ) {
    return this.intelligence.generate(ctx, query);
  }

  @Post('recommendations/:id/decisions')
  @RequirePermission(LEADFLOW_ANALYTICS_PERMISSIONS.recommendationsManage)
  decideRecommendation(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() decision: DecideIntelligenceRecommendationDto,
  ) {
    return this.intelligence.decide(ctx, id, decision);
  }

  @Post('recommendations/:id/evaluate')
  @RequirePermission(LEADFLOW_ANALYTICS_PERMISSIONS.recommendationsManage)
  evaluateRecommendation(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.intelligence.evaluate(ctx, id);
  }

  @Post('recommendations/:id/rollback')
  @RequirePermission(LEADFLOW_ANALYTICS_PERMISSIONS.recommendationsManage)
  rollbackRecommendation(
    @RequestContextData() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.intelligence.rollback(ctx, id);
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
