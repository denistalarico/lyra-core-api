import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import {
ContractTemplateStatus,
ContractTargetType,
} from '../enums';

export class ListContractTemplatesQueryDto {
@IsOptional()
@IsString()
search?: string;

@IsOptional()
@IsEnum(ContractTemplateStatus)
status?: ContractTemplateStatus;

@IsOptional()
@IsEnum(ContractTargetType)
targetType?: ContractTargetType;

@IsOptional()
@IsString()
@MaxLength(60)
category?: string;
}
