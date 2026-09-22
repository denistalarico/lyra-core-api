import { IsString, Matches, MaxLength } from 'class-validator';

export class AnalyticsThumbnailQueryDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'assetId must be a UUID.',
  })
  assetId!: string;

  /**
   * The provider's own post id.
   *
   * Digits for Instagram media, `<page>_<post>` for a Page post — never a UUID,
   * which is why this is not `@IsUUID`. The pattern is deliberately narrow: the
   * value is interpolated into a Graph path, so anything that could carry a
   * slash or a query separator is refused before it gets there.
   */
  @IsString()
  @MaxLength(80)
  @Matches(/^\d+(_\d+)?$/, {
    message: 'postId must be a provider publication id.',
  })
  postId!: string;
}
