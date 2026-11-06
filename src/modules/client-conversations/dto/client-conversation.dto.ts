import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
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

  /**
   * OR7 — the composer picked the Orion from the `@` list. A marker, not
   * metadata: the server records `metadata.assistantMention` only when the
   * body also carries a visible `@Orion`, and never trusts anything else.
   */
  @IsOptional()
  @IsIn(['orion'])
  assistantMention?: 'orion';
}

/** TC-CL1 — editable overrides; `null`/`''` clears back to the company. */
export class UpdateClientConversationDetailsDto {
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(120)
  title?: string | null;

  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  /** Inline raster data URL or http(s) URL; the service validates the shape. */
  @IsOptional()
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsString()
  @MaxLength(400_000)
  avatarUrl?: string | null;
}

export class ClientConversationMemberRefDto {
  @IsIn(['agency', 'client_area'])
  surface!: 'agency' | 'client_area';

  @IsUUID()
  userId!: string;
}

export class AddClientConversationMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ClientConversationMemberRefDto)
  members!: ClientConversationMemberRefDto[];
}

/** TC-CL1 — the reader's own mute; null turns notifications back on. */
export class UpdateClientConversationNotificationsDto {
  @ValidateIf((_object: unknown, value: unknown) => value !== null)
  @IsISO8601()
  mutedUntil!: string | null;
}
