import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import type {
  InboxChannelType,
  InboxChannelStatus,
} from '../entities/inbox-channel.entity';

export class CreateInboxChannelDto {
  @IsString()
  @MinLength(2)
  @MaxLength(140)
  name!: string;

  @IsOptional()
  @IsIn([
    'internal',
    'manual',
    'webchat',
    'whatsapp',
    'instagram',
    'facebook_messenger',
    'facebook',
    'email',
    'phone',
    'other',
  ])
  type?: InboxChannelType;

  @IsOptional()
  @IsIn(['draft', 'active', 'inactive', 'archived'])
  status?: InboxChannelStatus;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  externalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  externalAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  externalPhoneNumberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  externalPageId?: string;

  @IsOptional()
  @IsString()
  accessToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  verifyToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  webhookSecret?: string;

  @IsOptional()
  @IsUUID()
  defaultAssignedUserId?: string;

  @IsOptional()
  @IsUUID()
  defaultAgentId?: string;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
