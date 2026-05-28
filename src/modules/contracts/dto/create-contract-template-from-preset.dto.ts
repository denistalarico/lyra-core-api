import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ContractSignatureMode } from '../enums';

export class CreateContractTemplateFromPresetDto {
  @IsString()
  presetKey!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsEnum(ContractSignatureMode)
  defaultSignatureMode?: ContractSignatureMode;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
