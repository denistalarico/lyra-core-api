import { IsString, IsUUID, MaxLength, Matches } from 'class-validator';

/**
 * The query of an ad thumbnail read.
 *
 * Keyed on the **ad**, not on the creative. The creative id is what the picture
 * is ultimately fetched with, but accepting it here would mean accepting an
 * identifier the caller could have obtained anywhere and using it to make a
 * Graph call under this connection's credential. The ad id is looked up in
 * `social_ad_entities` inside the caller's own scope first, and the creative it
 * yields is the only one that is ever requested — the same discipline
 * `AnalyticsThumbnailQueryDto` follows for organic posts.
 */
export class AnalyticsAdThumbnailQueryDto {
  @IsUUID()
  connectionId!: string;

  /**
   * The ad's provider id: bare digits.
   *
   * Never a UUID, which is why this is not `@IsUUID`. The pattern is
   * deliberately narrow — the value reaches a repository lookup and, through
   * it, a Graph path, so anything that could carry a slash or a query separator
   * is refused before it gets there.
   */
  @IsString()
  @MaxLength(80)
  @Matches(/^\d+$/, { message: 'adId must be a provider ad id.' })
  adId!: string;
}
