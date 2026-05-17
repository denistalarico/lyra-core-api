import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CompleteWhatsAppEmbeddedSignupDto {
  @IsUUID()
  sessionId!: string;

  @IsString()
  @MinLength(8)
  code!: string;

  @IsString()
  @MaxLength(180)
  state!: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  businessId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  wabaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  phoneNumberId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayPhoneNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(12)
  phoneRegistrationPin?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
