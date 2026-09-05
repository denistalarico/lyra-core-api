import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const CANONICAL_KEY = /^[a-z0-9][a-z0-9_-]*$/;
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class SocialPublishingCadenceSlotDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsString()
  @Matches(CLOCK_TIME)
  time!: string;
}

export class SocialPublishingCadenceChannelDto {
  @IsString()
  @MaxLength(40)
  @Matches(CANONICAL_KEY)
  channel!: string;

  @IsBoolean()
  enabled!: boolean;

  /**
   * Omitted/null = inherit Planner monthlyContentVolume.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  frequencyPerMonth?: number | null;

  @IsArray()
  @ArrayMaxSize(31)
  @ValidateNested({ each: true })
  @Type(() => SocialPublishingCadenceSlotDto)
  slots!: SocialPublishingCadenceSlotDto[];
}

export class UpdateSocialPublishingCadenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  timezone?: string;

  @IsOptional()
  @IsBoolean()
  autoDistributionEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SocialPublishingCadenceChannelDto)
  channels?: SocialPublishingCadenceChannelDto[];
}
