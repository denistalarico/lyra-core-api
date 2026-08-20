import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendFacebookMessengerTextDto {
  @IsUUID()
  channelId!: string;

  @IsUUID()
  conversationId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  to!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  idempotencyKey?: string;
}
