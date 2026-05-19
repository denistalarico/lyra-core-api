import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  AgencyPermissionAccess,
  AgencyWorkspaceRole,
} from '../entities/agency-settings.entities';

export class PatchAgencyUserProfileDto {
  @IsString()
  @MaxLength(120)
  displayName!: string;

  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  jobTitle?: string | null;
}

export class PatchAgencyUserPreferencesDto {
  @IsIn(['light', 'dark', 'system'])
  themePreference!: 'light' | 'dark' | 'system';

  @IsIn(['pt-BR', 'en', 'es'])
  locale!: 'pt-BR' | 'en' | 'es';

  @IsString()
  @MaxLength(80)
  timezone!: string;

  @IsString()
  @MaxLength(20)
  dateFormat!: string;

  @IsIn(['12h', '24h'])
  timeFormat!: '12h' | '24h';

  @IsBoolean()
  sidebarCollapsed!: boolean;
}

export class PatchAgencyWorkspaceCompanyDto {
  @IsString()
  @MaxLength(120)
  legalName!: string;

  @IsString()
  @MaxLength(80)
  tradeName!: string;

  @IsString()
  @MaxLength(80)
  workspaceName!: string;

  @IsString()
  @MaxLength(20)
  taxIdType!: string;

  @IsString()
  @MaxLength(40)
  taxId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  supportEmail?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  billingEmail?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsString()
  @MaxLength(80)
  country!: string;

  @IsString()
  @MaxLength(10)
  currency!: string;

  @IsString()
  @MaxLength(10)
  defaultLocale!: string;

  @IsString()
  @MaxLength(80)
  timezone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  addressLine?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  industry?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  companySize?: string | null;
}

export class QuietHourDto {
  @IsString()
  @MaxLength(30)
  key!: string;

  @IsString()
  @MaxLength(30)
  label!: string;

  @IsString()
  @MaxLength(5)
  start!: string;

  @IsString()
  @MaxLength(5)
  end!: string;
}

export class PatchAgencyNotificationsDto {
  @IsBoolean()
  quietHoursEnabled!: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuietHourDto)
  quietHours!: QuietHourDto[];

  @IsInt()
  @Min(1)
  historyLimit!: number;

  @IsArray()
  preferences!: Array<Record<string, unknown>>;
}

export class PatchAgencyUserSecurityDto {
  @IsOptional()
  @IsBoolean()
  loginAlertsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  trustedDevicesEnabled?: boolean;
}

export class SetupAgencyTwoFactorDto {
  @IsOptional()
  @IsIn(['authenticator', 'email'])
  method?: 'authenticator' | 'email';
}

export class ConfirmAgencyTwoFactorDto {
  @IsOptional()
  @IsIn(['authenticator', 'email'])
  method?: 'authenticator' | 'email';

  @IsString()
  @MaxLength(12)
  code!: string;
}

export class PatchAgencySecurityDto {
  @IsBoolean()
  loginAlertsEnabled!: boolean;

  @IsBoolean()
  trustedDevicesEnabled!: boolean;

  @IsBoolean()
  twoFactorRequired!: boolean;

  @IsInt()
  @Min(8)
  passwordMinLength!: number;

  @IsString()
  @MaxLength(120)
  emailDomain!: string;

  @IsObject()
  emailTemplates!: Record<string, unknown>;
}

export class PatchAgencyAppsDto {
  @IsArray()
  apps!: Array<Record<string, unknown>>;
}

export class PatchAgencyEmailDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  fromName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  fromEmail?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  replyToEmail?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  smtpHost?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  smtpPort?: number | null;

  @IsOptional()
  @IsBoolean()
  smtpSecure?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  smtpUser?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  smtpPassword?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  imapHost?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  imapPort?: number | null;

  @IsOptional()
  @IsBoolean()
  imapSecure?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  imapUser?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imapPassword?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  status?: string;
}

export class PatchAgencyFinanceDto {
  @IsString()
  @MaxLength(10)
  currency!: string;

  @IsString()
  @MaxLength(80)
  country!: string;

  @IsString()
  @MaxLength(40)
  taxDocumentType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  taxDocument?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  fiscalRegime?: string | null;

  @IsString()
  @MaxLength(20)
  invoicePrefix!: string;

  @IsInt()
  @Min(1)
  nextInvoiceNumber!: number;

  @IsString()
  @MaxLength(40)
  defaultPaymentTerms!: string;

  @IsNumber()
  @Min(0)
  defaultLateFee!: number;

  @IsNumber()
  @Min(0)
  defaultMonthlyInterest!: number;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  billingEmail?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  fiscalEmail?: string | null;
}

export class PatchAgencySubscriptionsDto {
  @IsString()
  @MaxLength(40)
  planKey!: string;

  @IsString()
  @MaxLength(30)
  status!: string;

  @IsObject()
  limits!: Record<string, unknown>;
}

export class PatchAgencyAdvancedDto {
  @IsBoolean()
  developerMode!: boolean;

  @IsBoolean()
  apiAccessEnabled!: boolean;

  @IsBoolean()
  webhooksEnabled!: boolean;

  @IsObject()
  settings!: Record<string, unknown>;
}

export class AgencyWorkspaceIntegrationItemDto {
  @IsString()
  @MaxLength(80)
  itemId!: string;

  @IsIn(['integration', 'app'])
  category!: 'integration' | 'app';

  @IsIn(['available', 'connected', 'coming_soon', 'requires_setup'])
  status!: 'available' | 'connected' | 'coming_soon' | 'requires_setup';

  @IsBoolean()
  isInstalled!: boolean;

  @IsBoolean()
  isPinned!: boolean;

  @IsOptional()
  @IsInt()
  sidebarOrder?: number | null;
}

export class PatchAgencyIntegrationsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgencyWorkspaceIntegrationItemDto)
  items!: AgencyWorkspaceIntegrationItemDto[];
}

export class AgencyWorkspaceUserPermissionDto {
  @IsString()
  @MaxLength(40)
  appKey!: string;

  @IsIn(['full', 'partial', 'blocked'])
  access!: AgencyPermissionAccess;
}

export class PatchAgencyWorkspaceUserAccessDto {
  @IsIn(['owner', 'admin', 'manager', 'member'])
  role!: AgencyWorkspaceRole;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgencyWorkspaceUserPermissionDto)
  permissions!: AgencyWorkspaceUserPermissionDto[];
}

export class PatchAgencyPermissionMatrixDto {
  @IsObject()
  matrix!: Record<string, Record<AgencyWorkspaceRole, AgencyPermissionAccess>>;
}

export class InviteAgencyWorkspaceUserDto {
  @IsEmail()
  @MaxLength(160)
  email!: string;

  @IsIn(['admin', 'manager', 'member'])
  role!: Exclude<AgencyWorkspaceRole, 'owner'>;
}
