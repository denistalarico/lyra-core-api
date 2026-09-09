import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * The key is the pillar's stable identity across renames, so it is validated
 * to the same shape the database check enforces and cannot be changed after
 * creation — `UpdateSocialEditorialPillarDto` deliberately has no `key`.
 */
const PILLAR_KEY = /^[a-z0-9][a-z0-9_-]*$/;

export class CreateSocialEditorialPillarDto {
  @IsString()
  @MaxLength(80)
  @Matches(PILLAR_KEY, {
    message:
      'key must start with a letter or digit and contain only lowercase letters, digits, hyphen or underscore.',
  })
  key!: string;

  @IsString()
  @MaxLength(160)
  label!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  targetPercentage?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  color?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSocialEditorialPillarDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  label?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  targetPercentage?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  color?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
