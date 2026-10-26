// Compatibility entry point; the renderer is shared by Analytics products.
import { buildAnalyticsReportHtml } from '../../analytics-reports/analytics-report.renderer';

export * from '../../analytics-reports/analytics-report.renderer';

export const buildSocialAnalyticsReportHtml = buildAnalyticsReportHtml;
