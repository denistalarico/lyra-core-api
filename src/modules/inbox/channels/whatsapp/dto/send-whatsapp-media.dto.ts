import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class SendWhatsAppMediaDto {
  @IsUUID()
  channelId!: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(32)
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  idempotencyKey?: string;
}
