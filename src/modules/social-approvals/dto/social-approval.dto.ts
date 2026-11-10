import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSocialApprovalDto {
  @IsString() @IsIn(['creative_version', 'planner_content_revision']) subjectType!: string;
  @IsUUID() subjectId!: string;
  @IsUUID() subjectRevisionId!: string;
}
export class AddSocialApprovalCommentDto {
  @IsString() @MinLength(1) @MaxLength(8000) body!: string;
  /**
   * AP4 §2/§5 — explicit opt-in only. Omitted or any value other than
   * `'client'` stays `internal` at the service layer (the DTO only restricts
   * the accepted values; the default itself lives in
   * `SocialApprovalsService.comment`, so a caller that forgets this field
   * entirely still fails closed).
   */
  @IsOptional() @IsIn(['internal', 'client']) visibility?: 'internal' | 'client';
}
export class RequestSocialApprovalChangesDto extends AddSocialApprovalCommentDto {
  /** `reject` is the "não aprovado (refazer)" of the card; same status (D-12). */
  @IsOptional() @IsIn(['revise', 'reject']) kind?: 'revise' | 'reject';
}
export const APPROVAL_FEEDBACK_DECISIONS = [
  'approve',
  'approve_with_notes',
  'revise',
  'reject',
  'comment',
] as const;
export type ApprovalFeedbackDecision =
  (typeof APPROVAL_FEEDBACK_DECISIONS)[number];
/** Multipart text fields; the files come through the interceptor. */
export class ApprovalFeedbackDto {
  @IsIn(APPROVAL_FEEDBACK_DECISIONS) decision!: ApprovalFeedbackDecision;
  @IsOptional() @IsString() @MaxLength(40000) richBody?: string;
  /** One step of a piece whose steps are decided apart; absent means all. */
  @IsOptional() @IsUUID() approvalId?: string;
  @IsOptional() @IsIn(['internal', 'client']) visibility?: 'internal' | 'client';
}
export class ListSocialApprovalsDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsIn(['internal', 'client']) stage?: string;
  @IsOptional() @IsString() subjectType?: string;
  @IsOptional() @IsString() search?: string;
}

/**
 * CS5 Closeout — the cross-context list. `scope` narrows to the own scope or
 * to managed clients; the cursor is the `createdAt` of the last row.
 */
export class ListSocialApprovalInboxDto extends ListSocialApprovalsDto {
  @IsOptional()
  @IsIn(['all', 'own', 'managed'])
  scope?: 'all' | 'own' | 'managed';
  @IsOptional() @IsISO8601() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
