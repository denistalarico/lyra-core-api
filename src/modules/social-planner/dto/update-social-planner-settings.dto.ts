import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const CANONICAL_KEY = /^[a-z0-9][a-z0-9_-]*$/;

export class SocialPlannerFunnelDistributionDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  discovery!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  recognition!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  consideration!: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  decision!: number;
}

export class SocialPlannerCatalogItemDto {
  @IsString()
  @MaxLength(80)
  @Matches(CANONICAL_KEY)
  key!: string;

  @IsString()
  @MaxLength(120)
  label!: string;

  @IsBoolean()
  enabled!: boolean;
}

export class SocialPlannerHashtagDefaultsDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  mandatory!: string[];

  @IsInt()
  @Min(0)
  @Max(30)
  suggestedCount!: number;

  @IsBoolean()
  complementWithAi!: boolean;
}

export class SocialPlannerFirstCommentDefaultsDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  template!: string | null;
}

export class SocialPlannerMilestoneDto {
  @IsString()
  @MaxLength(80)
  @Matches(CANONICAL_KEY)
  key!: string;

  @IsString()
  @MaxLength(120)
  label!: string;

  @IsInt()
  @Min(0)
  @Max(365)
  daysBeforePublication!: number;

  @IsBoolean()
  enabled!: boolean;
}

export class UpdateSocialPlannerSettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  monthlyContentVolume?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => SocialPlannerFunnelDistributionDto)
  funnelDistribution?: SocialPlannerFunnelDistributionDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SocialPlannerCatalogItemDto)
  contentTypes?: SocialPlannerCatalogItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SocialPlannerCatalogItemDto)
  objectives?: SocialPlannerCatalogItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SocialPlannerCatalogItemDto)
  creativeFormats?: SocialPlannerCatalogItemDto[];

  /**
   * Objective key -> CTA suggestions.
   * Detailed semantic validation happens in the service.
   */
  @IsOptional()
  @IsObject()
  ctaDefaults?: Record<string, string[]>;

  @IsOptional()
  @ValidateNested()
  @Type(() => SocialPlannerHashtagDefaultsDto)
  hashtagDefaults?: SocialPlannerHashtagDefaultsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SocialPlannerFirstCommentDefaultsDto)
  firstCommentDefaults?: SocialPlannerFirstCommentDefaultsDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  hookLibrary?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SocialPlannerMilestoneDto)
  milestones?: SocialPlannerMilestoneDto[];
}
