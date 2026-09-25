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
import { SOCIAL_ORGANIC_TOP_STORY_SORTS } from '../views/social-organic-top-stories.view';

/**
 * The query for "Stories em destaque".
 *
 * Mirrors `AnalyticsTopPostsQueryDto` minus `surface`: there is nothing to
 * narrow, because a story *is* the surface and the stories live in a table of
 * their own.
 */
export class AnalyticsTopStoriesQueryDto {
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
   * Which counter orders the ranking. Defaults to views.
   *
   * Views rather than reach, unlike the posts table: a story's reach and views
   * are close together — it is shown to followers, mostly once — so views is
   * the figure with the spread that makes a top-five meaningful.
   */
  @IsOptional()
  @IsIn(SOCIAL_ORGANIC_TOP_STORY_SORTS)
  sort?: (typeof SOCIAL_ORGANIC_TOP_STORY_SORTS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
