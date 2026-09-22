import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import type { SocialCampaignAlertChannel } from '../entities';

const CHANNELS = [
  'in_app',
  'email',
  'whatsapp',
] satisfies SocialCampaignAlertChannel[];

export class SocialCampaignMonitorQueryDto {
  @IsUUID()
  connectionId!: string;
}

export class UpdateSocialCampaignMonitorPolicyDto {
  @IsUUID()
  connectionId!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(999_999_999_999)
  dailySpendLimitMinor?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(999_999_999_999)
  monthlySpendLimitMinor?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999_999_999_999)
  balanceFloorMinor?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(10_080)
  cooldownMinutes?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsIn(CHANNELS, { each: true })
  deliveryChannels?: SocialCampaignAlertChannel[];
}
