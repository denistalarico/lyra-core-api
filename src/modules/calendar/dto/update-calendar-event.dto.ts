import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type {
  CalendarEventStatus,
  CalendarEventType,
  CalendarEventVisibility,
} from '../entities/calendar-event.entity';

export class UpdateCalendarEventDto {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn([
    'internal_meeting',
    'client_meeting',
    'deadline',
    'delivery',
    'project_milestone',
    'task_due',
    'sales_follow_up',
    'time_block',
    'availability_block',
    'holiday',
  ])
  eventType?: CalendarEventType;

  @IsOptional()
  @IsIn(['scheduled', 'completed', 'canceled'])
  status?: CalendarEventStatus;

  @IsOptional()
  @IsIn(['workspace', 'team', 'private'])
  visibility?: CalendarEventVisibility;

  @IsOptional()
  @IsDateString()
  startsAt?: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  taskId?: string;

  @IsOptional()
  @IsUUID()
  salesOpportunityId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
