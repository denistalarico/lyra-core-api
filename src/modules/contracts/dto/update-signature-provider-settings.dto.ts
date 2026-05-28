import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { ContractSignatureMode } from '../enums';

export class UpdateSignatureProviderSettingsDto {
  @IsOptional()
  @IsString()
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsUrl({ require_tld: false })
  apiBaseUrl?: string | null;

  @IsOptional()
  @IsString()
  apiToken?: string | null;

  @IsOptional()
  @IsString()
  webhookSecret?: string | null;

  @IsOptional()
  @IsEnum(ContractSignatureMode)
  defaultSignatureMode?: ContractSignatureMode;

  @IsOptional()
  @IsBoolean()
  sandboxEnabled?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
