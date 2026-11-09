import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsUUID,
} from 'class-validator';
import { SOCIAL_CONTENT_BATCH_MAX } from '../../social-planner/dto/social-content-action.dto';

export const CONTENT_APPROVAL_MODES = [
  'copy',
  'creative',
  'sequential',
  'together',
] as const;
export type ContentApprovalMode = (typeof CONTENT_APPROVAL_MODES)[number];

export class SendContentForApprovalDto {
  @IsIn(CONTENT_APPROVAL_MODES)
  mode!: ContentApprovalMode;
}

export class SendContentBatchForApprovalDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(SOCIAL_CONTENT_BATCH_MAX)
  @IsUUID(undefined, { each: true })
  contentIds!: string[];

  @IsIn(CONTENT_APPROVAL_MODES)
  mode!: ContentApprovalMode;
}
