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
}
export class ListSocialApprovalsDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsIn(['internal', 'client']) stage?: string;
  @IsOptional() @IsString() subjectType?: string;
  @IsOptional() @IsString() search?: string;
}
