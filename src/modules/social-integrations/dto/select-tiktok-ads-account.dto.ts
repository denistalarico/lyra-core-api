import { IsString, Matches, MaxLength } from 'class-validator';

export class SelectTikTokAdsAccountDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[0-9a-fA-F-]{36}$/, {
    message: 'connectionId must be a UUID.',
  })
  connectionId!: string;

  /** TikTok advertiser id: digits only, validated before any lookup. */
  @IsString()
  @MaxLength(20)
  @Matches(/^\d{1,20}$/, {
    message: 'externalAccountId must be a TikTok advertiser id.',
  })
  externalAccountId!: string;
}
