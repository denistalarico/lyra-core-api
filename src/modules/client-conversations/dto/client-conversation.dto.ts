import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * CCOM1 — the body of a send.
 *
 * Deliberately tiny. There is no `senderUserId`, `tenantId`,
 * `companyContextId` or `conversationId` field: identity comes from the
 * verified session and scope from the validated path, so there is nothing here
 * a caller could claim about who they are or which company they are writing to.
 * The Team Chat socket accepted exactly those fields and trusted them
 * (CCOM0.5 §1); omitting them from the type is how that cannot recur.
 *
 * `kind` is also absent: it is derived server-side from whether attachments are
 * present, so a caller cannot label a message `system` and impersonate the
 * platform.
 */
export class SendClientConversationMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  body?: string;

  /** Opaque refs from a prior upload, bound to this message on create. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  attachmentIds?: string[];
}
