import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import type {
  SocialAdCampaignSort,
  SocialAdSortDirection,
} from '../views/social-ad-analytics-campaigns.view';

/**
 * The sortable columns, as a runtime value.
 *
 * Duplicated from the type union deliberately: `class-validator` needs an array
 * at runtime, and TypeScript unions do not survive compilation. The
 * `satisfies`-style annotation on the export keeps the two from drifting — a
 * value added to one and not the other fails the build.
 */
export const CAMPAIGN_SORT_VALUES: readonly SocialAdCampaignSort[] = [
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

export const SORT_DIRECTION_VALUES: readonly SocialAdSortDirection[] = [
  'asc',
  'desc',
];

/**
 * The query of a per-campaign read.
 *
 * `sort` and `direction` are validated against closed lists here *and* mapped
 * through a closed lookup in the service. Two layers on purpose: this one gives
 * the caller a 400 naming what is allowed, and the one in the service is what
 * guarantees no caller-supplied string can reach the ORDER BY even if this
 * validator were ever bypassed or relaxed.
 */
export class AnalyticsCampaignsQueryDto {
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

  /** Defaults to `spend` in the service — the column a ranking is usually about. */
  @IsOptional()
  @IsIn(CAMPAIGN_SORT_VALUES as string[])
  sort?: SocialAdCampaignSort;

  /** Defaults to `desc`: the biggest spender is the row people look for. */
  @IsOptional()
  @IsIn(SORT_DIRECTION_VALUES as string[])
  direction?: SocialAdSortDirection;
}
