import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import type { SocialAdSortDirection } from '../views/social-ad-analytics-campaigns.view';
import type { SocialAdAdSort } from '../views/social-ad-analytics-ads.view';
import { SORT_DIRECTION_VALUES } from './analytics-campaigns.query.dto';

/**
 * The sortable columns, as a runtime value — same duplication rationale as
 * `ADSET_SORT_VALUES`: `class-validator` needs an array at runtime and the
 * type union does not survive compilation.
 */
export const AD_SORT_VALUES: readonly SocialAdAdSort[] = [
  'spend',
  'impressions',
  'clicks',
  'leads',
  'conversions',
  'ctr',
  'cpc',
  'cpl',
  'roas',
  'name',
];

/**
 * The query of a per-ad read.
 *
 * Same two-layer validation as `AnalyticsAdSetsQueryDto`: this DTO gives the
 * caller a 400 naming what is allowed, and the service maps the value again
 * through a closed lookup so nothing reaches the ORDER BY as text.
 */
export class AnalyticsAdsQueryDto {
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

  /** Defaults to `spend` in the service. */
  @IsOptional()
  @IsIn(AD_SORT_VALUES as string[])
  sort?: SocialAdAdSort;

  /** Defaults to `desc`. */
  @IsOptional()
  @IsIn(SORT_DIRECTION_VALUES as string[])
  direction?: SocialAdSortDirection;
}
