import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
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

/** `auto` (the default): the server decides what changed and sends only that. */
export const CONTENT_APPROVAL_REQUEST_MODES = [
  ...CONTENT_APPROVAL_MODES,
  'auto',
] as const;
export type ContentApprovalRequestMode =
  (typeof CONTENT_APPROVAL_REQUEST_MODES)[number];

export class SendContentForApprovalDto {
  @IsOptional()
  @IsIn(CONTENT_APPROVAL_REQUEST_MODES)
  mode?: ContentApprovalRequestMode;
}

export class SendContentBatchForApprovalDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(SOCIAL_CONTENT_BATCH_MAX)
  @IsUUID(undefined, { each: true })
  contentIds!: string[];

  @IsOptional()
  @IsIn(CONTENT_APPROVAL_REQUEST_MODES)
  mode?: ContentApprovalRequestMode;
}
