import {
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  Min,
} from 'class-validator';

export class CreateScheduledItemReminderDto {
  @IsIn(['app', 'email', 'whatsapp', 'webhook'])
  reminderType!: string;

  @IsInt()
  @Min(0)
  offsetMinutes!: number;

  @IsOptional()
  @IsIn(['pending', 'sent', 'canceled', 'failed'])
  status?: string;

  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
