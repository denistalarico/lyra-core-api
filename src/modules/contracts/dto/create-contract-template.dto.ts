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
} from '../enums';

export class CreateContractTemplateDto {
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
