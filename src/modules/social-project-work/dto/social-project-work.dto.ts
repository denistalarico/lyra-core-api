import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  SOCIAL_PLAN_WORK_LINK_MODES,
  type SocialPlanWorkLinkMode,
} from '../entities';

export class PlanWorkOptionsQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class CreatePlanWorkLinkDto {
  @IsIn(SOCIAL_PLAN_WORK_LINK_MODES) mode!: SocialPlanWorkLinkMode;
  /** Required in `project_linked` and `task_created`. */
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsUUID() projectStageId?: string;
  /** `project_created`: defaults to the plan's title. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(180) projectName?: string;
  /** E5 `task_created`: start a new project instead of choosing one. */
  @IsOptional() @IsBoolean() createProject?: boolean;
  /** `task_created`: defaults to the plan's title. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(180) taskTitle?: string;
}

export const SUBTASK_APPROVAL_KINDS = [
  'text',
  'link',
  'file',
  'media',
] as const;
export type SubtaskApprovalKind = (typeof SUBTASK_APPROVAL_KINDS)[number];

export class SendSubtaskApprovalItemDto {
  @IsIn(SUBTASK_APPROVAL_KINDS) kind!: SubtaskApprovalKind;
  /** D-27: required only when the client has more than one company. */
  @IsOptional() @IsUUID() companyContextId?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20000) text?: string;
  /** D-29: http and https only; the server never fetches it. */
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  url?: string;
  @IsOptional() @IsString() @MaxLength(255) linkLabel?: string;
  /** `file`: an attachment of this task, or a media asset of the company. */
  @IsOptional() @IsUUID() attachmentId?: string;
  @IsOptional() @IsUUID() mediaAssetId?: string;
  @IsOptional() @IsString() @MaxLength(255) fileName?: string;
  /** `media`: one set, sent as a single item. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  mediaAssetIds?: string[];
}
