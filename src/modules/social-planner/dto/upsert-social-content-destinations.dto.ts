import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const CANONICAL_KEY = /^[a-z0-9][a-z0-9_-]*$/;

/** Video cover: an uploaded image and/or a moment of the video (ms). */
export class SocialContentDestinationCoverDto {
  @IsOptional()
  @IsUUID()
  mediaAssetId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4 * 60 * 60 * 1000)
  timestampMs?: number;
}

/** Network-specific options; an omitted key inherits the item. */
export class SocialContentDestinationOptionsDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  caption?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string | null;

  @IsOptional()
  @IsIn(['public', 'unlisted', 'private'])
  privacyStatus?: 'public' | 'unlisted' | 'private';

  @IsOptional()
  @IsBoolean()
  madeForKids?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,3}$/)
  categoryId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SocialContentDestinationCoverDto)
  cover?: SocialContentDestinationCoverDto;
}

export class SocialContentDestinationInputDto {
  @IsString()
  @MaxLength(40)
  @Matches(CANONICAL_KEY)
  channel!: string;

  @IsString()
  @MaxLength(40)
  @Matches(CANONICAL_KEY)
  placement!: string;

  @IsOptional()
  @IsISO8601()
  plannedAt?: string | null;

  /** Omitted = keep the stored options; present = replace them. */
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialContentDestinationOptionsDto)
  options?: SocialContentDestinationOptionsDto;
}

export class UpsertSocialContentDestinationsDto {
  @IsArray()
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => SocialContentDestinationInputDto)
  items!: SocialContentDestinationInputDto[];
}
