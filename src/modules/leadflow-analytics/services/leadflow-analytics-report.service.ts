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
    const reportTypes = Array.from(
      new Set(
        query.reportTypes?.length ? query.reportTypes : [query.reportType],
      ),
    );
    const includeCommercial =
      reportTypes.includes('overview') ||
      reportTypes.includes('commercial') ||
      Boolean(query.sectionIds?.includes('commercial_performance')) ||
      Boolean(
        query.summaryTypes?.some((type) =>
          ['executive', 'commercial'].includes(type),
        ),
      );
    const includeOperational =
      reportTypes.some((type) => type !== 'commercial') ||
      Boolean(
        query.sectionIds?.some((id) =>
          [
            'service_performance',
            'lead_quality',
            'automation_performance',
            'data_quality',
          ].includes(id),
        ),
      ) ||
      Boolean(
        query.summaryTypes?.some((type) =>
          ['executive', 'service', 'automation'].includes(type),
        ),
      );

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
      reportTypes,
      title: query.title,
      summaryTypes: query.summaryTypes,
      sectionIds: query.sectionIds,
      chartModes: query.chartModes,
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
      filename: `leadflow-${reportTypes.length > 1 ? 'completo' : query.reportType}-${from}-${to}.pdf`,
    };
  }
}
