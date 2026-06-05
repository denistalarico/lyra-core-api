import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from "class-validator";
import {
  AgencyKnowledgeVaultPermissionRole,
  AgencyKnowledgeVaultServiceType,
} from "../enums";

export class CreateKnowledgeVaultItemDto {
  @IsOptional()
  @IsUUID()
  clientId?: string | null;

  @IsOptional()
  @IsUUID()
  articleId?: string | null;

  @IsString()
  @MaxLength(180)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsEnum(AgencyKnowledgeVaultServiceType)
  serviceType?: AgencyKnowledgeVaultServiceType;

  @IsOptional()
  @IsString()
  serviceUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  loginIdentifier?: string | null;

  @IsString()
  secret!: string;

  @IsOptional()
  @IsString()
  secureNotes?: string | null;
}

export class UpdateKnowledgeVaultItemDto {
  @IsOptional()
  @IsUUID()
  clientId?: string | null;

  @IsOptional()
  @IsUUID()
  articleId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsEnum(AgencyKnowledgeVaultServiceType)
  serviceType?: AgencyKnowledgeVaultServiceType;

  @IsOptional()
  @IsString()
  serviceUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  loginIdentifier?: string | null;

  @IsOptional()
  @IsString()
  secret?: string;

  @IsOptional()
  @IsString()
  secureNotes?: string | null;
}

export class GrantKnowledgeVaultPermissionDto {
  @IsOptional()
  @IsUUID()
  userId?: string | null;

  @IsOptional()
  @IsEnum(AgencyKnowledgeVaultPermissionRole)
  role?: AgencyKnowledgeVaultPermissionRole | null;

  @IsOptional()
  @IsBoolean()
  canViewMetadata?: boolean;

  @IsOptional()
  @IsBoolean()
  canRevealSecret?: boolean;

  @IsOptional()
  @IsBoolean()
  canEditSecret?: boolean;

  @IsOptional()
  @IsBoolean()
  canManagePermissions?: boolean;
}

export class RevealKnowledgeVaultItemDto {
  @IsString()
  password!: string;
}
