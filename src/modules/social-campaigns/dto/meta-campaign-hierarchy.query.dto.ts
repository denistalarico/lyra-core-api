import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const META_CAMPAIGN_STATUS_FILTERS = [
  'all',
  'active',
  'paused',
  'archived',
] as const;

export type MetaCampaignStatusFilter =
  (typeof META_CAMPAIGN_STATUS_FILTERS)[number];

export class MetaCampaignHierarchyQueryDto {
  @IsUUID()
  connectionId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'since must be a date as YYYY-MM-DD.',
  })
  since!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'until must be a date as YYYY-MM-DD.',
  })
  until!: string;

  @IsOptional()
  @IsIn(META_CAMPAIGN_STATUS_FILTERS)
  status?: MetaCampaignStatusFilter;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
