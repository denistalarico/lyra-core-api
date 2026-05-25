import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  QuoteDiscountType,
  QuoteItemType,
  QuoteStatus,
  QuoteTemplateStatus,
  QuoteTemplateType,
} from '../entities/quote.entities';

export class QuoteListQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'converted', 'archived'])
  status?: QuoteStatus;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string;
}

export class CreateQuoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsOptional()
  @IsUUID()
  companyContactId?: string;

  @IsOptional()
  @IsUUID()
  opportunityId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  validUntil?: string;

  @IsOptional()
  @IsString()
  internalNotes?: string;

  @IsOptional()
  @IsString()
  termsAndConditions?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateQuoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  title?: string;

  @IsOptional()
  @IsUUID()
  templateId?: string | null;

  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  @IsOptional()
  @IsUUID()
  companyContactId?: string | null;

  @IsOptional()
  @IsUUID()
  opportunityId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsString()
  validUntil?: string | null;

  @IsOptional()
  @IsString()
  internalNotes?: string | null;

  @IsOptional()
  @IsString()
  termsAndConditions?: string | null;

  @IsOptional()
  @IsIn(['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'converted', 'archived'])
  status?: QuoteStatus;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateQuoteItemDto {
  @IsString()
  @MaxLength(140)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  salesItemId?: string;

  @IsOptional()
  @IsIn(['product', 'service', 'plan', 'recurring', 'setup', 'custom'])
  type?: QuoteItemType;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitPriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  setupPriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  recurringPriceCents?: number;

  @IsOptional()
  @IsIn(['none', 'fixed', 'percentage'])
  discountType?: QuoteDiscountType;

  @IsOptional()
  @IsInt()
  @Min(0)
  discountValue?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  taxRateBps?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  recurrenceInterval?: string;

  @IsOptional()
  @IsInt()
  position?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateQuoteItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(140)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUUID()
  salesItemId?: string | null;

  @IsOptional()
  @IsIn(['product', 'service', 'plan', 'recurring', 'setup', 'custom'])
  type?: QuoteItemType;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitPriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  setupPriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  recurringPriceCents?: number;

  @IsOptional()
  @IsIn(['none', 'fixed', 'percentage'])
  discountType?: QuoteDiscountType;

  @IsOptional()
  @IsInt()
  @Min(0)
  discountValue?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  taxRateBps?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  recurrenceInterval?: string | null;

  @IsOptional()
  @IsInt()
  position?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ChangeQuoteStatusDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  acceptedByName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  acceptedByEmail?: string;
}

export class CreateQuoteTemplateDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn([
    'simple_quote',
    'commercial_proposal',
    'monthly_service',
    'one_time_project',
    'premium_consultative',
    'custom',
  ])
  type?: QuoteTemplateType;

  @IsOptional()
  @IsIn(['active', 'inactive', 'archived'])
  status?: QuoteTemplateStatus;

  @IsOptional()
  isDefault?: boolean;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  sections?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateQuoteTemplateDto extends CreateQuoteTemplateDto {}
