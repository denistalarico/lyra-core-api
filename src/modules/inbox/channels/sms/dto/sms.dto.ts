import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SMS_PROVIDERS, type SmsProviderKey } from '../sms-provider.adapter';

export class SendSmsTextDto {
  @IsUUID()
  channelId!: string;

  // An SMS conversation always exists before a person answers it: the lead
  // wrote first, or the follow-up opened it.
  @IsUUID()
  conversationId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(32)
  to!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1600)
  text!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  idempotencyKey?: string;
}

export class SendSmsMediaDto {
  @IsUUID()
  channelId!: string;

  @IsUUID()
  conversationId!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(32)
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1600)
  caption?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  idempotencyKey?: string;
}

export class ConnectSmsChannelDto {
  @IsIn(SMS_PROVIDERS)
  provider!: SmsProviderKey;

  @IsString()
  @MinLength(8)
  @MaxLength(400)
  apiKey!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(32)
  phoneNumber!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  messagingProfileId!: string;

  @IsString()
  @MinLength(40)
  @MaxLength(200)
  publicKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  helpText?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  name?: string | null;
}

export class UpdateSmsChannelSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(320)
  helpText?: string | null;
}
