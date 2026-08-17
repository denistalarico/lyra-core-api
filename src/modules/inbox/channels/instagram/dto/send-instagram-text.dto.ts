import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendInstagramTextDto {
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
  @MaxLength(1000)
  text!: string;

  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  idempotencyKey?: string;
}
