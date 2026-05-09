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
  InboxChannelStatus,
  InboxChannelType,
} from '../entities/inbox-channel.entity';

export class PatchInboxChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(140)
  name?: string;

  @IsOptional()
  @IsIn([
    'manual',
    'webchat',
    'whatsapp',
    'instagram',
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
