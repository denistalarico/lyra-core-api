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

export class CreateScheduledItemDto {
  @IsIn(['event', 'meeting', 'follow_up', 'task', 'call', 'reminder'])
  type!: string;

  @IsOptional()
  @IsIn(['scheduled', 'in_progress', 'completed', 'canceled', 'missed', 'postponed'])
  status?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  @IsString()
  @MaxLength(180)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsISO8601()
  startAt?: string;

  @IsOptional()
  @IsISO8601()
  endAt?: string;

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsIn(['none', 'physical', 'video', 'phone'])
  locationType?: string;

  @IsOptional()
  @IsString()
  locationText?: string;

  @IsOptional()
  @IsIn(['external_url', 'native'])
  videoMode?: string;

  @IsOptional()
  @IsString()
  videoUrl?: string;

  @IsOptional()
  @IsString()
  phoneUrl?: string;

  @IsOptional()
  @IsIn(['private', 'workspace', 'participants'])
  visibility?: string;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsIn(['manual', 'email', 'whatsapp', 'inbox', 'phone', 'webchat', 'instagram', 'facebook', 'other'])
  sourceChannel?: string;

  @IsOptional()
  @IsUUID()
  sourceConversationId?: string;

  @IsOptional()
  @IsUUID()
  sourceLeadId?: string;

  @IsOptional()
  @IsUUID()
  sourceOpportunityId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
