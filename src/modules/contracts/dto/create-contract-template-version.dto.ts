import {
IsEnum,
IsObject,
IsOptional,
IsString,
} from 'class-validator';
import { ContractSignatureMode } from '../enums';

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
@IsObject()
variablesSchema?: Record<string, unknown>;

@IsOptional()
@IsObject()
metadata?: Record<string, unknown>;
}
