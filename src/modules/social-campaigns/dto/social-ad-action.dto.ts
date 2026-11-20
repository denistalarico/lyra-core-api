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
  ValidateNested,
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

  @IsBoolean()
  allowBoost!: boolean;

  /** GA-WRITE: optional so the Meta editor keeps working; absent = unchanged. */
  @IsOptional()
  @IsBoolean()
  allowKeywords?: boolean;

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

/**
 * GA-WRITE (D-G5): keyword-like change on Google. `text` limits are the
 * KeywordInfo ones (80 characters, 10 words: fields/v25/campaign_criterion);
 * control characters are refused. Never interpolated into GAQL.
 */
export class GoogleAdKeywordPayloadDto {
  @IsIn(['add', 'remove'])
  op!: 'add' | 'remove';

  @IsString()
  @Matches(/^\P{Cc}{1,80}$/u)
  text!: string;

  @IsOptional()
  @IsIn(['EXACT', 'PHRASE', 'BROAD'])
  matchType?: 'EXACT' | 'PHRASE' | 'BROAD';
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

  /** Google `negative_keyword`, `keyword` and `search_theme` only. */
  @IsOptional()
  @ValidateNested()
  @Type(() => GoogleAdKeywordPayloadDto)
  payload?: GoogleAdKeywordPayloadDto;
}

export class ConfirmSocialAdActionDto {
  @IsUUID()
  confirmationRequestId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  confirmationText?: string;
}
