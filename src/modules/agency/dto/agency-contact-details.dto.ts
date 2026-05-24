import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import type {
  AgencyBankAccountCurrency,
  AgencyBillingChannel,
} from '../entities/agency-contact-details.entities';

export class UpdateAgencyContactProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  avatarObjectKey?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  avatarUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string | null;

  @IsOptional()
  @IsIn(['email', 'sms', 'whatsapp'])
  billingChannel?: AgencyBillingChannel | null;
}

export class CreateAgencyContactIdentificationTypeDto {
  @IsString()
  @Length(2, 80)
  name!: string;

  @IsString()
  @Length(2, 40)
  code!: string;
}

export class UpdateAgencyContactIdentificationTypeDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(2, 40)
  code?: string;
}

export class CreateAgencyBankDto {
  @IsString()
  @Length(2, 160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  bicSwift?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  complement?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;
}

export class UpdateAgencyBankDto {
  @IsOptional()
  @IsString()
  @Length(2, 160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  bicSwift?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  street?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  number?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  complement?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  postalCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string | null;
}

export class CreateAgencyContactBankAccountDto {
  @IsUUID()
  contactId!: string;

  @IsOptional()
  @IsUUID()
  bankId?: string | null;

  @IsString()
  @Length(1, 120)
  accountNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  agencyNumber?: string | null;

  @IsString()
  @Length(2, 160)
  holderName!: string;

  @IsOptional()
  @IsBoolean()
  canSendMoney?: boolean;

  @IsOptional()
  @IsIn(['BRL', 'ARS', 'USD'])
  currency?: AgencyBankAccountCurrency;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  iban?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}

export class UpdateAgencyContactBankAccountDto {
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  bankId?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  accountNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  agencyNumber?: string | null;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  holderName?: string;

  @IsOptional()
  @IsBoolean()
  canSendMoney?: boolean;

  @IsOptional()
  @IsIn(['BRL', 'ARS', 'USD'])
  currency?: AgencyBankAccountCurrency;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  iban?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}
