import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type {
  InboxConversationPriority,
  InboxConversationStatus,
} from '../entities/inbox-conversation.entity';

export class PatchInboxConversationDto {
  @IsOptional()
  @IsUUID()
  channelId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  externalThreadId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsIn([
    'new',
    'open',
    'pending',
    'waiting',
    'handoff_requested',
    'resolved',
    'closed',
    'archived',
  ])
  status?: InboxConversationStatus;

  @IsOptional()
  @IsIn(['low', 'normal', 'high', 'urgent'])
  priority?: InboxConversationPriority;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @IsOptional()
  @IsUUID()
  assignedAgentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  businessMode?: string;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
