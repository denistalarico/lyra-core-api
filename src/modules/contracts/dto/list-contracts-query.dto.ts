import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import {
ContractSignatureMode,
ContractSignatureProvider,
ContractStatus,
ContractTargetType,
} from '../enums';

export class ListContractsQueryDto {
@IsOptional()
@IsString()
search?: string;

@IsOptional()
@IsEnum(ContractStatus)
status?: ContractStatus;

@IsOptional()
@IsEnum(ContractTargetType)
targetType?: ContractTargetType;

@IsOptional()
@IsUUID()
targetId?: string;

@IsOptional()
@IsUUID()
templateId?: string;

@IsOptional()
@IsEnum(ContractSignatureMode)
signatureMode?: ContractSignatureMode;

@IsOptional()
@IsEnum(ContractSignatureProvider)
signatureProvider?: ContractSignatureProvider;

@IsOptional()
@IsString()
includeArchived?: string;
}
