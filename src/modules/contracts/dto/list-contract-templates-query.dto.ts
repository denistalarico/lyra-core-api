import { IsEnum, IsOptional, IsString } from 'class-validator';
import {
ContractCategory,
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
@IsEnum(ContractCategory)
category?: ContractCategory;
}
