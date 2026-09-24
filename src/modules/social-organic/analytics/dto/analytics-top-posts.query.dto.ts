import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import {
  SOCIAL_ORGANIC_POST_SURFACES,
  SOCIAL_ORGANIC_TOP_POST_SORTS,
} from '../views/social-organic-top-posts.view';

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

  /**
   * Narrows the ranking to one surface. Omitted, every surface is ranked
   * together — which is what the single posts table has always done and stays
   * the default, so an existing caller is unaffected.
   *
   * The values are Lyra's own (`feed`, `reel`, `story`), not Meta's: the
   * provider spells the same surface several ways and the read layer maps them,
   * so a client that had to send `CAROUSEL_CONTAINER` to get carousels would be
   * carrying the provider's inconsistency into the URL.
   */
  @IsOptional()
  @IsIn(SOCIAL_ORGANIC_POST_SURFACES)
  surface?: (typeof SOCIAL_ORGANIC_POST_SURFACES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
