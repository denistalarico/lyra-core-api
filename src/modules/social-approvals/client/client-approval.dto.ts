import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
  IsString,
  MaxLength,
  MinLength,
  IsIn,
} from 'class-validator';

/** A client comment independent of any decision (§37). */
export class ClientApprovalCommentDto {
  @IsString() @MinLength(1) @MaxLength(8000) body!: string;
}

/**
 * §21 — the reason is required by the contract, not merely by the UI: a
 * request for changes with no reason gives the agency nothing to act on.
 */
export class ClientApprovalRequestChangesDto {
  @IsString() @MinLength(1) @MaxLength(8000) body!: string;
  @IsOptional() @IsIn(['revise', 'reject']) kind?: 'revise' | 'reject';
}

/**
 * D-02: only the text fields; `source` and the author come from the server.
 * An absent field keeps its current value and `null` clears it.
 */
export class ClientApprovalEditTextDto {
  @IsOptional() @IsString() @MaxLength(20000) copy?: string | null;
  @IsOptional() @IsString() @MaxLength(20000) caption?: string | null;
  @IsOptional() @IsString() @MaxLength(20000) script?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) cta?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  hashtags?: string[];
  @IsOptional() @IsString() @MaxLength(5000) firstComment?: string | null;
  /** "Salvar e aprovar": the decision commits with the edit, or neither does. */
  @IsOptional() @IsBoolean() approve?: boolean;
}

/** AR4 / D-06: the read-only section of a task or subtask. */
export class ClientApprovalWorkItemsQueryDto {
  @IsUUID() taskId!: string;
  @IsOptional() @IsUUID() subtaskId?: string;
}
