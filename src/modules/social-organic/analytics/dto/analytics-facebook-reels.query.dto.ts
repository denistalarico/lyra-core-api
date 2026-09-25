import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { SOCIAL_ORGANIC_FACEBOOK_REEL_SORTS } from '../views/social-organic-facebook-reels.view';

/**
 * The query for "Reels em destaque" on a Facebook Page.
 *
 * Its own DTO rather than `AnalyticsTopPostsQueryDto` because the sort keys are
 * a different set — a Facebook reel is ranked by plays and unique viewers,
 * neither of which a post reports — and reusing that DTO would accept a sort
 * this endpoint cannot honour.
 */
export class AnalyticsFacebookReelsQueryDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'assetId must be a UUID.',
  })
  assetId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'since must be YYYY-MM-DD.' })
  since!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'until must be YYYY-MM-DD.' })
  until!: string;

  /**
   * Which counter orders the ranking. Defaults to plays.
   *
   * Plays rather than unique viewers, though both are available: plays is the
   * figure Meta itself headlines for a reel, so a ranking by anything else
   * would disagree with the Page owner's own dashboard at a glance.
   */
  @IsOptional()
  @IsIn(SOCIAL_ORGANIC_FACEBOOK_REEL_SORTS)
  sort?: (typeof SOCIAL_ORGANIC_FACEBOOK_REEL_SORTS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
