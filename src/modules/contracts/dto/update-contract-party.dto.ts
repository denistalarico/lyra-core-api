import {
IsEmail,
IsEnum,
IsInt,
IsObject,
IsOptional,
IsString,
IsUUID,
Max,
MaxLength,
Min,
} from 'class-validator';
import {
ContractPartyRole,
ContractPartySignatureStatus,
} from '../enums';

export class UpdateContractPartyDto {
@IsOptional()
@IsEnum(ContractPartyRole)
role?: ContractPartyRole;

@IsOptional()
@IsUUID()
contactId?: string | null;

@IsOptional()
@IsUUID()
userId?: string | null;

@IsOptional()
@IsString()
@MaxLength(160)
name?: string;

@IsOptional()
@IsEmail()
@MaxLength(180)
email?: string | null;

@IsOptional()
@IsString()
@MaxLength(40)
document?: string | null;

@IsOptional()
@IsEnum(ContractPartySignatureStatus)
signatureStatus?: ContractPartySignatureStatus;

@IsOptional()
@IsInt()
@Min(1)
@Max(99)
signatureOrder?: number;

@IsOptional()
@IsObject()
metadata?: Record<string, unknown>;
}
