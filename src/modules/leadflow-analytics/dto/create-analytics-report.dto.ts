import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsObject,
  IsString,
  MaxLength,
} from 'class-validator';
import { GetOperationalAnalyticsDto } from './get-operational-analytics.dto';

export const LEADFLOW_ANALYTICS_REPORT_TYPES = [
  'overview',
  'commercial',
  'messages',
  'lead_score',
  'automations',
] as const;

export type LeadFlowAnalyticsReportType =
  (typeof LEADFLOW_ANALYTICS_REPORT_TYPES)[number];

const REPORT_SUMMARY_TYPES = [
  'executive',
  'service',
  'commercial',
  'automation',
] as const;

const REPORT_SECTION_IDS = [
  'commercial_performance',
  'service_performance',
  'lead_quality',
  'automation_performance',
  'recommendations',
  'data_quality',
] as const;

export class CreateAnalyticsReportDto extends GetOperationalAnalyticsDto {
  @IsOptional()
  @IsIn(LEADFLOW_ANALYTICS_REPORT_TYPES)
  reportType: LeadFlowAnalyticsReportType = 'overview';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsIn(LEADFLOW_ANALYTICS_REPORT_TYPES, { each: true })
  reportTypes?: LeadFlowAnalyticsReportType[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(REPORT_SUMMARY_TYPES, { each: true })
  summaryTypes?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(REPORT_SECTION_IDS, { each: true })
  sectionIds?: string[];

  @IsOptional()
  @IsObject()
  chartModes?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;
}
