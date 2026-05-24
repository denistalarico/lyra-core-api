import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import type {
  ContactBusinessMode,
  ContactLifecycleStage,
  ContactSource,
  ContactStatus,
  ContactType,
} from '../entities/contact.entity';

export class PatchContactDto {
  @IsOptional()
  @IsIn(['person', 'organization'])
  type?: ContactType;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  documentType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  documentNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @IsOptional()
  @IsUUID()
  companyContactId?: string | null;

  @IsOptional()
  @IsIn([
    'manual',
    'whatsapp',
    'instagram',
    'facebook',
    'webchat',
    'form',
    'import',
    'referral',
    'email',
    'other',
  ])
  source?: ContactSource;

  @IsOptional()
  @IsIn([
    'general',
    'service_quote',
    'clinic_booking',
    'restaurant_order',
    'agency_service',
    'ecommerce',
    'education',
    'real_estate',
    'other',
  ])
  businessMode?: ContactBusinessMode;

  @IsOptional()
  @IsIn([
    'lead',
    'prospect',
    'customer',
    'partner',
    'supplier',
    'internal',
    'other',
  ])
  lifecycleStage?: ContactLifecycleStage;

  @IsOptional()
  @IsIn(['active', 'inactive', 'archived'])
  status?: ContactStatus;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}
