import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query parameters for the managerial income statement (DRE Gerencial).
 *
 * Period resolution priority (handled in the service):
 *   1. startDate + endDate (explicit window);
 *   2. year + month (single month);
 *   3. year only (full calendar year);
 *   4. fallback: current month.
 *
 * `compare=true` adds the immediately preceding window of the same length so the
 * UI can show period-over-period deltas.
 */
export class FinanceDreQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1970)
  @Max(9999)
  year?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  compare?: boolean;
}
