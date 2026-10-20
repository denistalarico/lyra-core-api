import { IsOptional, IsString, MaxLength } from 'class-validator';
import { GetOperationalAnalyticsDto } from './get-operational-analytics.dto';

export class GetLeadFlowTimeseriesDto extends GetOperationalAnalyticsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  metrics?: string;
}
