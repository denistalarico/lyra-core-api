import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  ContractCategory,
  ContractSignatureMode,
  ContractTargetType,
  ContractTemplateEditorMode,
} from '../enums';

export class CreateCustomContractTemplateDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsEnum(ContractCategory)
  category!: ContractCategory;

  @IsEnum(ContractTargetType)
  targetType!: ContractTargetType;

  @IsOptional()
  @IsEnum(ContractSignatureMode)
  defaultSignatureMode?: ContractSignatureMode;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jurisdictionRegion?: string | null;

  @IsOptional()
  @IsEnum(ContractTemplateEditorMode)
  editorMode?: ContractTemplateEditorMode;

  @IsOptional()
  @IsString()
  legalDisclaimer?: string | null;

  @IsOptional()
  @IsString()
  headerHtml?: string | null;

  @IsString()
  bodyHtml!: string;

  @IsOptional()
  @IsString()
  footerHtml?: string | null;

  @IsOptional()
  @IsObject()
  variablesSchema?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
