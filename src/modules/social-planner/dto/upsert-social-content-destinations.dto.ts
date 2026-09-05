import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const CANONICAL_KEY = /^[a-z0-9][a-z0-9_-]*$/;

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
}

export class UpsertSocialContentDestinationsDto {
  @IsArray()
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => SocialContentDestinationInputDto)
  items!: SocialContentDestinationInputDto[];
}
