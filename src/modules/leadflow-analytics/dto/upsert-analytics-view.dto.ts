import {
  ArrayMaxSize,
  IsBoolean,
  IsArray,
  IsIn,
  IsOptional,
  IsObject,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  LEADFLOW_ANALYTICS_REPORT_TYPES,
  type LeadFlowAnalyticsReportType,
} from './create-analytics-report.dto';

export const LEADFLOW_ANALYTICS_WIDGET_IDS = [
  'commercial_performance',
  'service_performance',
  'lead_quality',
  'automation_performance',
  'commercial_summary',
  'operational_summary',
  'recommendations',
  'data_quality',
] as const;

export const LEADFLOW_ANALYTICS_SUMMARY_TYPES = [
  'executive',
  'service',
  'commercial',
  'automation',
] as const;

export type LeadFlowAnalyticsSummaryType =
  (typeof LEADFLOW_ANALYTICS_SUMMARY_TYPES)[number];

export const LEADFLOW_ANALYTICS_CHART_IDS = [
  'commercial_stages',
  'commercial_handoff',
  'message_channels',
  'agent_performance',
  'lead_score_distribution',
  'automation_outcomes',
] as const;

export const LEADFLOW_ANALYTICS_CHART_MODES = [
  'horizontal_bar',
  'vertical_bar',
  'pie',
  'line',
  'area',
] as const;

export type LeadFlowAnalyticsChartMode =
  (typeof LEADFLOW_ANALYTICS_CHART_MODES)[number];

export class UpsertAnalyticsViewDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsIn(LEADFLOW_ANALYTICS_REPORT_TYPES)
  reportType!: LeadFlowAnalyticsReportType;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;

  @IsOptional()
  @IsUUID()
  channelId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9_-]*$/i)
  businessMode?: string;

  @IsOptional()
  @IsUUID()
  agentId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(LEADFLOW_ANALYTICS_WIDGET_IDS, { each: true })
  widgetOrder?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(LEADFLOW_ANALYTICS_WIDGET_IDS, { each: true })
  hiddenWidgetIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(LEADFLOW_ANALYTICS_SUMMARY_TYPES, { each: true })
  summaryTypes?: LeadFlowAnalyticsSummaryType[];

  @IsOptional()
  @IsObject()
  chartModes?: Record<string, LeadFlowAnalyticsChartMode>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
