import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const ENTITY_LEVELS = ['campaign', 'adset', 'ad'] as const;

export class SocialAdActionPolicyQueryDto {
  @IsUUID()
  connectionId!: string;
}

export class UpdateSocialAdActionPolicyDto {
  @IsUUID()
  connectionId!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsBoolean()
  allowStatus!: boolean;

  @IsBoolean()
  allowBudget!: boolean;

  @IsBoolean()
  allowSchedule!: boolean;

  @IsBoolean()
  allowDelete!: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9_000_000_000_000)
  maxBudgetMinor?: number | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  maxBudgetIncreasePercent!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  confirmationTtlMinutes!: number;
}

export class SocialAdActionHistoryQueryDto extends SocialAdActionPolicyQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class SocialAdActionPreflightDto {
  @IsUUID()
  connectionId!: string;

  @IsIn(ENTITY_LEVELS)
  entityLevel!: (typeof ENTITY_LEVELS)[number];

  @Matches(/^\d{1,40}$/)
  entityExternalId!: string;

  @IsUUID()
  requestId!: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'PAUSED'])
  status?: 'ACTIVE' | 'PAUSED';

  @IsOptional()
  @IsIn(['daily', 'lifetime'])
  budgetKind?: 'daily' | 'lifetime';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9_000_000_000_000)
  budgetAmountMinor?: number;

  @IsOptional()
  @IsISO8601({ strict: true })
  endsAt?: string;
}

export class ConfirmSocialAdActionDto {
  @IsUUID()
  confirmationRequestId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  confirmationText?: string;
}
