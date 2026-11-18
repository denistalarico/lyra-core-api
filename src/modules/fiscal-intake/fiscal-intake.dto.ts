import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  FISCAL_INTAKE_SCOPES,
  type FiscalIntakeScope,
} from './fiscal-intake.types';

export class CreateFiscalIntakeRequestDto {
  @IsOptional()
  @IsIn(FISCAL_INTAKE_SCOPES)
  scope?: FiscalIntakeScope;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  recipientName?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  recipientEmail?: string | null;

  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}

export class RejectFiscalIntakeDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string | null;
}

/** Multipart text fields of the public submission (the file comes apart). */
export class SubmitFiscalIntakeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  data?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  certificatePassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  portalPassword?: string;
}

export class InspectFiscalCertificateDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  certificatePassword?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  cnpj?: string;
}
