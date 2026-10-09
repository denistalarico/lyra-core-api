import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import type { MeetingAiConfig } from '../meeting-ai.types';

export class SaveMeetingAiSettingsDto implements MeetingAiConfig {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsUUID() expenseAccountId!: string | null;
  @IsOptional() @IsUUID() costCenterId!: string | null;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.05) @Max(20) maxCostUsd!: number;
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(5)
  @Max(180)
  maxCaptureMinutes!: number;
  @IsNumber({ maxDecimalPlaces: 0 }) @Min(1) @Max(90) retentionDays!: number;
}
