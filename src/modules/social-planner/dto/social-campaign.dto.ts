import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import type { SocialCampaignStatus } from '../entities';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const CAMPAIGN_STATUSES = [
  'planned',
  'active',
  'completed',
  'archived',
] satisfies SocialCampaignStatus[];

/**
 * No DTO in this file accepts tenantId, workspaceId or agencyClientId.
 *
 * Scope is resolved from the request context by the controller. Accepting a
 * client id here would let a caller attach a campaign to another client's
 * Social context.
 */
export class CreateSocialCampaignTemplateDto {
  @IsString()
  @MaxLength(240)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  objective?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultDurationDays?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  recommendedPillars?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSocialCampaignTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  objective?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  defaultDurationDays?: number | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  recommendedPillars?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateSocialCampaignDto {
  @IsString()
  @MaxLength(240)
  name!: string;

  /**
   * Provenance, validated against the caller's own scope by the service. A
   * template id from another context resolves to "not found", never to a
   * cross-context read.
   */
  @IsOptional()
  @IsUUID()
  templateId?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  objective?: string | null;

  @IsOptional()
  @Matches(ISO_DATE)
  startsOn?: string | null;

  @IsOptional()
  @Matches(ISO_DATE)
  endsOn?: string | null;

  @IsOptional()
  @IsIn(CAMPAIGN_STATUSES)
  status?: SocialCampaignStatus;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  color?: string | null;
}

export class UpdateSocialCampaignDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  objective?: string | null;

  @IsOptional()
  @Matches(ISO_DATE)
  startsOn?: string | null;

  @IsOptional()
  @Matches(ISO_DATE)
  endsOn?: string | null;

  @IsOptional()
  @IsIn(CAMPAIGN_STATUSES)
  status?: SocialCampaignStatus;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  color?: string | null;
}
