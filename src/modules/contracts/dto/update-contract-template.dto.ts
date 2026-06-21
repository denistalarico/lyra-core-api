import {
IsEnum,
IsObject,
IsOptional,
IsString,
MaxLength,
} from 'class-validator';
import {
ContractFooterPreset,
ContractHeaderPreset,
ContractSignatureMode,
ContractTemplateEditorMode,
ContractTargetType,
} from '../enums';

export class UpdateContractTemplateDto {
@IsOptional()
@IsString()
@MaxLength(160)
name?: string;

@IsOptional()
@IsString()
description?: string | null;

@IsOptional()
@IsString()
@MaxLength(60)
category?: string;

@IsOptional()
@IsEnum(ContractTargetType)
targetType?: ContractTargetType;

@IsOptional()
@IsEnum(ContractSignatureMode)
defaultSignatureMode?: ContractSignatureMode;

@IsOptional()
@IsString()
headerHtml?: string | null;

@IsOptional()
@IsString()
bodyHtml?: string;

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
@IsEnum(ContractTemplateEditorMode)
editorMode?: ContractTemplateEditorMode;

@IsOptional()
@IsString()
legalDisclaimer?: string | null;

@IsOptional()
@IsObject()
variablesSchema?: Record<string, unknown>;

@IsOptional()
@IsObject()
metadata?: Record<string, unknown>;
}
