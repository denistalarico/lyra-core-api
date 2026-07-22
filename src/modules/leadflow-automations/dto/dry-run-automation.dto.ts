import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Situation to simulate.
 *
 * Every field is optional; omitting the body simulates a plausible "the trigger
 * just fired" case. Supplying values is how an operator explores the
 * cancellation paths ("what if the lead already replied?") without waiting for
 * one to happen for real.
 */
export class DryRunAutomationDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  leadScore?: number;

  @IsOptional()
  @IsBoolean()
  leadReplied?: boolean;

  @IsOptional()
  @IsBoolean()
  handoffActive?: boolean;

  @IsOptional()
  @IsBoolean()
  insideBusinessHours?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  attemptsSoFar?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8760)
  hoursSinceLastRun?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @Type(() => String)
  matchedKeywords?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @Type(() => String)
  matchedIntents?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  @Type(() => String)
  presentFields?: string[];
}
