import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { TaskPriority, TaskStatus, TaskVisibility } from '../../enums';

export class CreateTaskDto {
  @IsString()
  @MaxLength(180)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUUID()
  projectId?: string | null;

  @IsOptional()
  @IsUUID()
  clientId?: string | null;

  @IsOptional()
  @IsUUID()
  stageId?: string | null;

  @IsOptional()
  @IsUUID()
  projectStageId?: string | null;

  @IsOptional()
  @IsUUID()
  personalStageId?: string | null;

  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  taskTypeId?: string | null;

  @IsOptional()
  @IsEnum(TaskVisibility)
  visibility?: TaskVisibility;

  @IsOptional()
  @IsDateString()
  startDate?: string | null;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedMinutes?: number | null;

  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;

  @IsOptional()
  @IsString()
  blockedReason?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  markerIds?: string[];

  @IsOptional()
  @IsString()
  coverImageUrl?: string | null;
}
