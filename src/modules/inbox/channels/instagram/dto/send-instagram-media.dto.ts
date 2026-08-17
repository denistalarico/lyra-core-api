import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendInstagramMediaDto {
  @IsUUID()
  channelId!: string;

  @IsUUID()
  conversationId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  to!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  caption?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  idempotencyKey?: string;
}
