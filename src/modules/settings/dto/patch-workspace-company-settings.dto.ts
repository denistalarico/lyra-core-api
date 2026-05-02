// src/modules/settings/dto/patch-workspace-company-settings.dto.ts
import {
  IsEmail,
  IsHexColor,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class PatchWorkspaceCompanySettingsDto {
  @IsString()
  @Length(2, 120)
  legalName!: string;

  @IsString()
  @Length(2, 80)
  publicName!: string;

  @IsString()
  @MaxLength(63)
  workspaceName!: string;

  @IsIn(['cnpj', 'ein', 'other'])
  taxIdType!: 'cnpj' | 'ein' | 'other';

  @ValidateIf((o: PatchWorkspaceCompanySettingsDto) => o.taxIdType === 'other')
  @IsString()
  @Length(2, 60)
  taxIdCustomLabel?: string;

  @IsString()
  @MaxLength(40)
  taxId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsHexColor()
  primaryColor!: string;

  @IsHexColor()
  secondaryColor!: string;

  @IsOptional()
  @IsEmail()
  supportEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  instagramHandle?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  facebookUrl?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  linkedinUrl?: string;

  @IsString()
  @MaxLength(80)
  country!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  stateRegion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  industry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  companySize?: string;

  @IsString()
  @MaxLength(80)
  timezone!: string;
}
