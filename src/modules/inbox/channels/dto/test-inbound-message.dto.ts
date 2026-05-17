import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import type {
  NormalizedInboundChannelType,
  NormalizedInboundMessageType,
  NormalizedInboundSender,
  NormalizedInboundAttachment,
} from '../types/normalized-inbound-message';

export class TestInboundMessageDto {
  @IsUUID()
  channelId!: string;

  @IsIn([
    'internal',
    'webchat',
    'whatsapp',
    'instagram',
    'facebook_messenger',
    'email',
    'phone',
    'other',
  ])
  channelType!: NormalizedInboundChannelType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  provider?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(220)
  externalThreadId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  externalMessageId?: string;

  @IsObject()
  sender!: NormalizedInboundSender;

  @IsIn([
    'text',
    'image',
    'audio',
    'video',
    'file',
    'location',
    'contact',
    'system',
    'unknown',
  ])
  messageType!: NormalizedInboundMessageType;

  @IsString()
  @MinLength(1)
  content!: string;

  @IsOptional()
  attachments?: NormalizedInboundAttachment[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, unknown>;
}
