import {
IsEnum,
IsObject,
IsOptional,
IsString,
} from 'class-validator';
import {
ContractFooterPreset,
ContractHeaderPreset,
ContractSignatureMode,
} from '../enums';

export class CreateContractTemplateVersionDto {
@IsOptional()
@IsEnum(ContractSignatureMode)
signatureMode?: ContractSignatureMode;

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
@IsObject()
variablesSchema?: Record<string, unknown>;

@IsOptional()
@IsObject()
metadata?: Record<string, unknown>;
}
