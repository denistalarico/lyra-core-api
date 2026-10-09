import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TaskPriority } from '../../projects/enums';

/**
 * CS5-B production commands. No scope field exists in any of them: tenant,
 * workspace, client and Company Context come only from the request context,
 * and asset/media ids are never accepted — the server resolves them from the
 * version or from the explicit selection.
 */
export class SelectCreativeVersionDto {
  @IsUUID()
  versionId!: string;
}

export class LinkProductionTaskDto {
  @IsUUID()
  taskId!: string;

  /** A subtask is an `agency_task_checklist_items` row of that task. */
  @IsOptional()
  @IsUUID()
  subtaskId?: string;
}

/**
 * Opt-in task creation through the Agency owner. Due date and assignee are
 * explicit: no deadline is derived from the Planner date in CS5-B.
 */
export class CreateProductionTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  projectStageId?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  taskTypeId?: string;
}

export class HandoffProductionDestinationDto {
  /** The connected account the version is validated against (Planner E5 rule). */
  @IsUUID()
  organicAssetId!: string;

  /** Required to replace a creative already on the destination. */
  @IsOptional()
  @IsBoolean()
  replaceExisting?: boolean;
}
