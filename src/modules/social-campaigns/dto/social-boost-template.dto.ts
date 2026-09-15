import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type {
  SocialBoostAudienceMode,
  SocialBoostBudgetType,
  SocialBoostConversionLocation,
  SocialBoostObjective,
  SocialBoostPerformanceGoal,
} from '../entities';
import {
  SOCIAL_BOOST_CONVERSION_LOCATIONS,
  SOCIAL_BOOST_OBJECTIVES,
  SOCIAL_BOOST_PERFORMANCE_GOALS,
} from '../social-boost-template-options';

const CURRENT_PROVIDERS = ['meta'] as const;
const BUDGET_TYPES = ['daily', 'lifetime'] satisfies SocialBoostBudgetType[];
const AUDIENCE_MODES = [
  'automatic',
  'custom',
  'saved',
  'followers',
  'engagers',
] satisfies SocialBoostAudienceMode[];
const SPECIAL_AD_CATEGORIES = [
  'CREDIT',
  'EMPLOYMENT',
  'HOUSING',
  'ISSUES_ELECTIONS_POLITICS',
] as const;

export class SocialBoostAudienceDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @Matches(/^[A-Za-z]{2}$/, { each: true })
  countries?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  regions?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  cities?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(24, { each: true })
  postalCodes?: string[];

  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(65)
  ageMin?: number | null;

  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(65)
  ageMax?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @MaxLength(24, { each: true })
  genders?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  languages?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  interests?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(180)
  savedAudienceExternalId?: string | null;
}

export class CreateSocialBoostTemplateDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  /** Schema is provider-ready, while the first product slice accepts Meta only. */
  @IsIn(CURRENT_PROVIDERS)
  provider!: 'meta';

  @IsIn(SOCIAL_BOOST_OBJECTIVES)
  objective!: SocialBoostObjective;

  @IsIn(SOCIAL_BOOST_PERFORMANCE_GOALS)
  performanceGoal!: SocialBoostPerformanceGoal;

  @IsIn(SOCIAL_BOOST_CONVERSION_LOCATIONS)
  conversionLocation!: SocialBoostConversionLocation;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(/^[A-Za-z0-9_ -]+$/)
  conversionEvent?: string | null;

  @IsIn(BUDGET_TYPES)
  budgetType!: SocialBoostBudgetType;

  @IsInt()
  @Min(100)
  @Max(999_999_999_999)
  budgetAmountMinor!: number;

  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency!: string;

  @IsInt()
  @Min(1)
  @Max(90)
  durationDays!: number;

  @IsIn(AUDIENCE_MODES)
  audienceMode!: SocialBoostAudienceMode;

  @IsOptional()
  @ValidateNested()
  @Type(() => SocialBoostAudienceDto)
  audience?: SocialBoostAudienceDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  placements?: string[];

  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @IsIn(SPECIAL_AD_CATEGORIES, { each: true })
  specialAdCategories!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  callToAction?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUrl({ require_protocol: true })
  destinationUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSocialBoostTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsIn(SOCIAL_BOOST_OBJECTIVES)
  objective?: SocialBoostObjective;

  @IsOptional()
  @IsIn(SOCIAL_BOOST_PERFORMANCE_GOALS)
  performanceGoal?: SocialBoostPerformanceGoal;

  @IsOptional()
  @IsIn(SOCIAL_BOOST_CONVERSION_LOCATIONS)
  conversionLocation?: SocialBoostConversionLocation;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(/^[A-Za-z0-9_ -]+$/)
  conversionEvent?: string | null;

  @IsOptional()
  @IsIn(BUDGET_TYPES)
  budgetType?: SocialBoostBudgetType;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(999_999_999_999)
  budgetAmountMinor?: number;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  durationDays?: number;

  @IsOptional()
  @IsIn(AUDIENCE_MODES)
  audienceMode?: SocialBoostAudienceMode;

  @IsOptional()
  @ValidateNested()
  @Type(() => SocialBoostAudienceDto)
  audience?: SocialBoostAudienceDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  placements?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @IsIn(SPECIAL_AD_CATEGORIES, { each: true })
  specialAdCategories?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(60)
  callToAction?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUrl({ require_protocol: true })
  destinationUrl?: string | null;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
