import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

// Query for the monthly client-profitability series. When no window is given
// the service defaults to the trailing 12 months; `months` is ignored when an
// explicit `startMonth` is provided.
export class ClientProfitabilityMonthlyQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'startMonth must be in YYYY-MM format' })
  startMonth?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'endMonth must be in YYYY-MM format' })
  endMonth?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(36)
  months?: number;
}
