import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import { ContractFooterPreset, ContractHeaderPreset } from '../enums';

export class PreviewContractTemplateDto {
  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  headerHtml?: string | null;

  @IsString()
  bodyHtml!: string;

  @IsOptional()
  @IsString()
  footerHtml?: string | null;

  @IsOptional()
  @IsEnum(ContractHeaderPreset)
  headerPreset?: ContractHeaderPreset | null;

  @IsOptional()
  @IsEnum(ContractFooterPreset)
  footerPreset?: ContractFooterPreset | null;

  @IsOptional()
  showLogo?: boolean;

  @IsOptional()
  showCompanyData?: boolean;

  @IsOptional()
  showContractNumber?: boolean;

  @IsOptional()
  showPoweredByLyra?: boolean;

  @IsOptional()
  @IsObject()
  variablesData?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  title?: string;
}
