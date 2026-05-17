import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SendWhatsAppTextDto {
  @IsUUID()
  channelId!: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(32)
  to!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text!: string;
}
