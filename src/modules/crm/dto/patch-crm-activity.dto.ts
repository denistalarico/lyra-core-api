import { IsDateString, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class PatchCrmActivityDto {
  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  @IsOptional()
  @IsUUID()
  inboxConversationId?: string | null;

  @IsOptional()
  @IsIn(['note', 'call', 'email', 'meeting', 'task', 'follow_up'])
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsIn(['open', 'done', 'canceled'])
  status?: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
