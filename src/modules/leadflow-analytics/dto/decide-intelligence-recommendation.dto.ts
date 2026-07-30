import {
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class DecideIntelligenceRecommendationDto {
  @IsIn(['approve', 'reject', 'snooze'])
  action!: 'approve' | 'reject' | 'snooze';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  snoozedUntil?: string;
}
