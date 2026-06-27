import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { TaskPriority, TaskStatus, TaskVisibility } from '../../enums';

export class ListTasksQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  stageId?: string;

  @IsOptional()
  @IsUUID()
  projectStageId?: string;

  @IsOptional()
  @IsUUID()
  personalStageId?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsEnum(TaskVisibility)
  visibility?: TaskVisibility;

  @IsOptional()
  @IsString()
  includeArchived?: string;
}
