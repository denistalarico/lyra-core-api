import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { INBOX_FOLLOWUP_TEMPLATE_STEP_KEYS } from '../entities/inbox-followup-template.entity';

/** Channels a follow-up template may be limited to (inbox channel types). */
export const INBOX_FOLLOWUP_TEMPLATE_CHANNEL_TYPES = [
  'instagram',
  'facebook_messenger',
  'whatsapp',
  'sms',
] as const;

export class CreateInboxFollowupTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsIn(INBOX_FOLLOWUP_TEMPLATE_STEP_KEYS)
  stepKey!: (typeof INBOX_FOLLOWUP_TEMPLATE_STEP_KEYS)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(INBOX_FOLLOWUP_TEMPLATE_CHANNEL_TYPES.length)
  @IsIn(INBOX_FOLLOWUP_TEMPLATE_CHANNEL_TYPES, { each: true })
  channelTypes?: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class UpdateInboxFollowupTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(INBOX_FOLLOWUP_TEMPLATE_STEP_KEYS)
  stepKey?: (typeof INBOX_FOLLOWUP_TEMPLATE_STEP_KEYS)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(INBOX_FOLLOWUP_TEMPLATE_CHANNEL_TYPES.length)
  @IsIn(INBOX_FOLLOWUP_TEMPLATE_CHANNEL_TYPES, { each: true })
  channelTypes?: string[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;
}

export class SendInboxFollowupDto {
  /** A template to render; or `text`, already edited by the person. */
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  text?: string;

  @IsIn(['d0', 'd1', 'd3', 'd7'])
  stepKey!: 'd0' | 'd1' | 'd3' | 'd7';

  @IsString()
  @MinLength(8)
  @MaxLength(160)
  idempotencyKey!: string;
}
