import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const TARGETING_KINDS = ['location', 'interest', 'language', 'saved_audience'] as const;

export class SocialBoostTargetingQueryDto {
  @IsUUID()
  connectionId!: string;

  @IsIn(TARGETING_KINDS)
  kind!: (typeof TARGETING_KINDS)[number];

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  query?: string;
}
