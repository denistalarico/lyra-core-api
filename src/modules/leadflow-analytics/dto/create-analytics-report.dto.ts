import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
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

export class CreateAnalyticsReportDto extends GetOperationalAnalyticsDto {
  @IsOptional()
  @IsIn(LEADFLOW_ANALYTICS_REPORT_TYPES)
  reportType: LeadFlowAnalyticsReportType = 'overview';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;
}
