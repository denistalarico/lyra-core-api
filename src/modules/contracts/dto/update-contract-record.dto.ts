import {
IsDateString,
IsEnum,
IsObject,
IsOptional,
IsString,
IsUUID,
MaxLength,
} from 'class-validator';
import {
ContractSignatureMode,
ContractSignatureProvider,
ContractStatus,
ContractTargetType,
} from '../enums';

export class UpdateContractRecordDto {
@IsOptional()
@IsString()
@MaxLength(180)
title?: string;

@IsOptional()
@IsEnum(ContractTargetType)
targetType?: ContractTargetType;

@IsOptional()
@IsUUID()
targetId?: string | null;

@IsOptional()
@IsUUID()
templateId?: string | null;

@IsOptional()
@IsUUID()
templateVersionId?: string | null;

@IsOptional()
@IsEnum(ContractStatus)
status?: ContractStatus;

@IsOptional()
@IsEnum(ContractSignatureMode)
signatureMode?: ContractSignatureMode;

@IsOptional()
@IsEnum(ContractSignatureProvider)
signatureProvider?: ContractSignatureProvider;

@IsOptional()
@IsString()
externalDocumentId?: string | null;

@IsOptional()
@IsObject()
variablesData?: Record<string, unknown>;

@IsOptional()
@IsString()
generatedHtml?: string | null;

@IsOptional()
@IsDateString()
validFrom?: string | null;

@IsOptional()
@IsDateString()
validUntil?: string | null;

@IsOptional()
@IsObject()
metadata?: Record<string, unknown>;
}
