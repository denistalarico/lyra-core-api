import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { SOCIAL_ORGANIC_TOP_POST_SORTS } from '../views/social-organic-top-posts.view';

export class AnalyticsTopPostsQueryDto {
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
   * Which lifetime counter orders the ranking. Defaults to reach.
   *
   * A closed list rather than free text, because the value chooses a field to
   * order by — the same discipline the paid module's sort DTOs follow.
   */
  @IsOptional()
  @IsIn(SOCIAL_ORGANIC_TOP_POST_SORTS)
  sort?: (typeof SOCIAL_ORGANIC_TOP_POST_SORTS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
