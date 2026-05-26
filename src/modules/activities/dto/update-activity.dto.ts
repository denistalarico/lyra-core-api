import {
  IsDateString,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  ActivityPriority,
  ActivityStatus,
  ActivityType,
  ActivityVisibility,
} from '../enums';

export class UpdateActivityDto {
  @IsOptional()
  @IsEnum(ActivityType)
  type?: ActivityType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  subtype?: string | null;

  @IsOptional()
  @IsEnum(ActivityStatus)
  status?: ActivityStatus;

  @IsOptional()
  @IsEnum(ActivityPriority)
  priority?: ActivityPriority;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  summary?: string;

  @IsOptional()
  @IsString()
  note?: string | null;

  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @IsOptional()
  @IsDateString()
  startAt?: string | null;

  @IsOptional()
  @IsDateString()
  endAt?: string | null;

  @IsOptional()
  @IsUUID()
  assignedToId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sourceModule?: string | null;

  @IsOptional()
  @IsEnum(ActivityVisibility)
  visibility?: ActivityVisibility;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
