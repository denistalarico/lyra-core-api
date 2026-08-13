import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * The four named attempts of the follow-up cadence.
 *
 * Declared here as literals rather than imported from the automations catalog:
 * the CRM does not depend on LeadFlow Automations, and inverting that would
 * close a cycle. `crm-opportunity-follow-up.spec.ts` asserts the two agree.
 */
const FOLLOW_UP_STEP_KEYS = ['d0', 'd1', 'd3', 'd7'];
const FOLLOW_UP_CHANNELS = [
  'whatsapp',
  'email',
  'sms',
  'facebook_messenger',
  'instagram_direct',
  'webchat',
];

export class PatchCrmOpportunityFollowTemplateDto {
  @IsString()
  @MaxLength(512)
  providerTemplateName!: string;

  @IsString()
  @MaxLength(35)
  languageCode!: string;
}

export class PatchCrmOpportunityFollowChannelDto {
  @IsIn(FOLLOW_UP_CHANNELS)
  channel!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsBoolean()
  outsideWindowEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  connectionRef?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => PatchCrmOpportunityFollowTemplateDto)
  whatsappTemplate?: PatchCrmOpportunityFollowTemplateDto;
}

export class PatchCrmOpportunityFollowStepDto {
  @IsIn(FOLLOW_UP_STEP_KEYS)
  stepKey!: string;

  @IsBoolean()
  enabled!: boolean;

  /** Only the same-day attempt varies; the rest are normalized on read. */
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 30)
  delayMinutes!: number;

  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => PatchCrmOpportunityFollowChannelDto)
  channels!: PatchCrmOpportunityFollowChannelDto[];
}

export class PatchCrmOpportunityFollowTextsDto {
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  d0?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  d1?: string | null;
}

export class PatchCrmOpportunityFollowDto {
  @IsOptional()
  @IsIn(['automatic', 'manual', 'disabled'])
  followMode?: string;

  @IsOptional()
  @IsDateString()
  nextFollowUpAt?: string | null;

  @IsOptional()
  @IsString()
  followMessage?: string | null;

  @IsOptional()
  @IsBoolean()
  followSendAutomatically?: boolean;

  /** The plan this card runs on its own, in manual mode. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => PatchCrmOpportunityFollowStepDto)
  steps?: PatchCrmOpportunityFollowStepDto[];

  /** What the two in-conversation attempts say. */
  @IsOptional()
  @ValidateNested()
  @Type(() => PatchCrmOpportunityFollowTextsDto)
  texts?: PatchCrmOpportunityFollowTextsDto;
}
