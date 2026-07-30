import { Injectable } from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { DocumentPdfRendererService } from '../../document-layouts/document-pdf-renderer.service';
import type { CreateAnalyticsReportDto } from '../dto/create-analytics-report.dto';
import { LeadFlowAnalyticsService } from './leadflow-analytics.service';
import { buildLeadFlowAnalyticsReportHtml } from './leadflow-analytics-report.renderer';
import { LeadFlowOperationalAnalyticsService } from './leadflow-operational-analytics.service';

@Injectable()
export class LeadFlowAnalyticsReportService {
  constructor(
    private readonly commercialAnalytics: LeadFlowAnalyticsService,
    private readonly operationalAnalytics: LeadFlowOperationalAnalyticsService,
    private readonly pdfRenderer: DocumentPdfRendererService,
  ) {}

  async renderPdf(ctx: RequestContext, query: CreateAnalyticsReportDto) {
    const includeCommercial =
      query.reportType === 'overview' || query.reportType === 'commercial';
    const includeOperational = query.reportType !== 'commercial';

    const [commercial, operational] = await Promise.all([
      includeCommercial
        ? this.commercialAnalytics.getCommercialJourney(ctx, query)
        : Promise.resolve(null),
      includeOperational
        ? this.operationalAnalytics.getOverview(ctx, query)
        : Promise.resolve(null),
    ]);
    const generatedAt = new Date();
    const html = buildLeadFlowAnalyticsReportHtml({
      reportType: query.reportType,
      title: query.title,
      commercial,
      operational,
      generatedAt,
    });
    const buffer = await this.pdfRenderer.renderHtmlToPdf(html, {
      format: 'A4',
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm',
      },
    });
    const period = commercial?.period ?? operational?.period;
    const from =
      period?.from.slice(0, 10) ?? generatedAt.toISOString().slice(0, 10);
    const to = period?.to.slice(0, 10) ?? from;

    return {
      buffer,
      filename: `leadflow-${query.reportType}-${from}-${to}.pdf`,
    };
  }
}
