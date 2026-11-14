import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GA4_DIMENSIONS, type Ga4Dimension } from '../entities';

const PROPERTY_ID = /^\d{1,20}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * No tenant, workspace or client field: scope comes from the authenticated
 * context, and the global ValidationPipe rejects unknown keys.
 */
export class Ga4PropertyQueryDto {
  @Matches(PROPERTY_ID, { message: 'propertyId must be numeric.' })
  propertyId!: string;
}

/** Bare `YYYY-MM-DD` days in the property's own zone, never instants. */
export class Ga4PeriodQueryDto extends Ga4PropertyQueryDto {
  @IsString()
  @Matches(DAY, { message: 'since must be a date as YYYY-MM-DD.' })
  since!: string;

  @IsString()
  @Matches(DAY, { message: 'until must be a date as YYYY-MM-DD.' })
  until!: string;
}

export class Ga4BreakdownQueryDto extends Ga4PeriodQueryDto {
  @IsIn(GA4_DIMENSIONS)
  dimension!: Ga4Dimension;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class Ga4SyncBodyDto extends Ga4PropertyQueryDto {
  @IsOptional()
  @IsString()
  @Matches(DAY, { message: 'since must be a date as YYYY-MM-DD.' })
  since?: string;

  @IsOptional()
  @IsString()
  @Matches(DAY, { message: 'until must be a date as YYYY-MM-DD.' })
  until?: string;
}
