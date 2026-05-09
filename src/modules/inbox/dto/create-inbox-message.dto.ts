import { IsArray, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { InboxMessageDirection, InboxMessageSenderType, InboxMessageType, InboxMessageStatus } from '../entities/inbox-message.entity';

export class CreateInboxMessageDto {
  @IsOptional()
  @IsIn(['inbound', 'outbound', 'internal', 'system'])
  direction?: InboxMessageDirection;

  @IsOptional()
  @IsIn(['contact', 'user', 'agent', 'system'])
  senderType?: InboxMessageSenderType;

  @IsOptional()
  @IsUUID()
  senderUserId?: string;

  @IsOptional()
  @IsUUID()
  senderAgentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  externalMessageId?: string;

  @IsOptional()
  @IsIn(['text', 'note', 'media', 'event', 'template'])
  messageType?: InboxMessageType;

  @IsString()
  @MinLength(1)
  content!: string;

  @IsOptional()
  @IsIn(['draft', 'sent', 'delivered', 'read', 'failed'])
  status?: InboxMessageStatus;

  @IsOptional()
  @IsArray()
  attachments?: unknown[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
