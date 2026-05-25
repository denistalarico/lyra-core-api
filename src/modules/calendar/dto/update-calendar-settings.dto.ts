import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type {
  CalendarDefaultView,
  CalendarSharingPermission,
} from '../entities/calendar-settings.entity';

export class UpdateCalendarSettingsDto {
  @IsOptional()
  @IsIn(['day', 'week', 'month', 'list'])
  defaultView?: CalendarDefaultView;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(480)
  defaultEventDurationMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekStartsOn?: number;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  workdayStartTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  workdayEndTime?: string;

  @IsOptional()
  @IsBoolean()
  quietHoursEnabled?: boolean;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  quietHoursStartTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  quietHoursEndTime?: string;

  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  emailNotificationsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  inAppNotificationsEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  defaultReminderMinutes?: number;

  @IsOptional()
  @IsBoolean()
  calendarSharingEnabled?: boolean;

  @IsOptional()
  @IsIn(['view', 'edit'])
  defaultSharingPermission?: CalendarSharingPermission;
}
