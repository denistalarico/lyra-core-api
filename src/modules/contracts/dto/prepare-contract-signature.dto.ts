import { IsEnum, IsOptional, IsString } from 'class-validator';
import {
  ContractSignatureMode,
  ContractSignatureProvider,
} from '../enums';

export class PrepareContractSignatureDto {
  @IsEnum(ContractSignatureMode)
  signatureMode!: ContractSignatureMode;

  @IsOptional()
  @IsEnum(ContractSignatureProvider)
  signatureProvider?: ContractSignatureProvider;

  @IsOptional()
  @IsString()
  note?: string | null;
}
