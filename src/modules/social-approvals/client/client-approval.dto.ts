import { IsString, MaxLength, MinLength } from 'class-validator';

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
}
