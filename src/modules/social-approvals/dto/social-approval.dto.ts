import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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
export class ListSocialApprovalsDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsIn(['internal', 'client']) stage?: string;
  @IsOptional() @IsString() subjectType?: string;
  @IsOptional() @IsString() search?: string;
}
