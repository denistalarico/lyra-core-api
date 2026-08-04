import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  LEADFLOW_ANALYTICS_REPORT_TYPES,
  type LeadFlowAnalyticsReportType,
} from './create-analytics-report.dto';

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
}
