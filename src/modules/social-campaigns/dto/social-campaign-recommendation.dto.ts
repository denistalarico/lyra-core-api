import { Type } from 'class-transformer';
import { IsInt, IsUUID, Matches, Max, Min } from 'class-validator';

export class SocialCampaignRecommendationListQueryDto {
  @IsUUID()
  connectionId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 10;
}

export class GenerateSocialCampaignRecommendationDto {
  @IsUUID()
  connectionId!: string;

  @IsUUID()
  requestId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  since!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  until!: string;
}
