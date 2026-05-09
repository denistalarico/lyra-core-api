import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class PatchScheduledItemDto {
  @IsOptional()
  @IsIn(['event', 'meeting', 'follow_up', 'task', 'call', 'reminder'])
  type?: string;

  @IsOptional()
  @IsIn(['scheduled', 'in_progress', 'completed', 'canceled', 'missed', 'postponed'])
  status?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsISO8601()
  startAt?: string | null;

  @IsOptional()
  @IsISO8601()
  endAt?: string | null;

  @IsOptional()
  @IsISO8601()
  dueAt?: string | null;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string | null;

  @IsOptional()
  @IsIn(['none', 'physical', 'video', 'phone'])
  locationType?: string;

  @IsOptional()
  @IsString()
  locationText?: string | null;

  @IsOptional()
  @IsIn(['external_url', 'native'])
  videoMode?: string | null;

  @IsOptional()
  @IsString()
  videoUrl?: string | null;

  @IsOptional()
  @IsString()
  phoneUrl?: string | null;

  @IsOptional()
  @IsIn(['private', 'workspace', 'participants'])
  visibility?: string;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string | null;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string | null;

  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  @IsOptional()
  @IsIn(['manual', 'email', 'whatsapp', 'inbox', 'phone', 'webchat', 'instagram', 'facebook', 'other'])
  sourceChannel?: string;

  @IsOptional()
  @IsUUID()
  sourceConversationId?: string | null;

  @IsOptional()
  @IsUUID()
  sourceLeadId?: string | null;

  @IsOptional()
  @IsUUID()
  sourceOpportunityId?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
