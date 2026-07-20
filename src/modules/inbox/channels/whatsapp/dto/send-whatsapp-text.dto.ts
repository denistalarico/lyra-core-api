import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

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

  // Id interno da mensagem respondida. O serviço resolve o `wamid` da Meta e
  // envia como `context`, para o balão citado aparecer no app do destinatário.
  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  idempotencyKey?: string;
}
