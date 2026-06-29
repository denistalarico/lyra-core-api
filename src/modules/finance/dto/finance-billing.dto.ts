import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  FinanceAllocationTargetType,
  FinanceBillRecurrenceFrequency,
  FinanceBillRecurrenceStatus,
  FinanceBillStatus,
  FinanceInvoiceStatus,
  FinancePaymentDirection,
  FinancePaymentMethod,
  FinancePaymentStatus,
  FinanceRecurringInterval,
  FinanceRecurringProfileStatus,
} from '../enums';

export class FinanceInvoiceLineInputDto {
  @IsOptional()
  @IsUUID()
  productId?: string | null;

  @IsOptional()
  @IsUUID()
  serviceId?: string | null;

  @IsString()
  @MaxLength(255)
  description!: string;

  @IsOptional()
  @IsNumberString()
  quantity?: string;

  @IsOptional()
  @IsNumberString()
  unitPrice?: string;

  @IsOptional()
  @IsNumberString()
  discountAmount?: string;

  @IsOptional()
  @IsNumberString()
  taxAmount?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsUUID()
  costCenterId?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateFinanceInvoiceDto {
  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sourceModule?: string | null;

  @IsOptional()
  @IsUUID()
  sourceId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  invoiceNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsDateString()
  issueDate?: string | null;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsDateString()
  periodStart?: string | null;

  @IsOptional()
  @IsDateString()
  periodEnd?: string | null;

  @IsOptional()
  @IsString()
  terms?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FinanceInvoiceLineInputDto)
  lines!: FinanceInvoiceLineInputDto[];
}

export class UpdateFinanceInvoiceDto {
  @IsOptional()
  @IsEnum(FinanceInvoiceStatus)
  status?: FinanceInvoiceStatus;

  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @IsOptional()
  @IsDateString()
  issueDate?: string | null;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsDateString()
  periodStart?: string | null;

  @IsOptional()
  @IsDateString()
  periodEnd?: string | null;

  @IsOptional()
  @IsString()
  terms?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class AddFinanceInvoiceLineDto extends FinanceInvoiceLineInputDto {}

export class UpdateFinanceInvoiceLineDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsNumberString()
  quantity?: string;

  @IsOptional()
  @IsNumberString()
  unitPrice?: string;

  @IsOptional()
  @IsNumberString()
  discountAmount?: string;

  @IsOptional()
  @IsNumberString()
  taxAmount?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsUUID()
  costCenterId?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class FinanceBillLineInputDto {
  @IsString()
  @MaxLength(255)
  description!: string;

  @IsOptional()
  @IsNumberString()
  quantity?: string;

  @IsOptional()
  @IsNumberString()
  unitPrice?: string;

  @IsOptional()
  @IsNumberString()
  taxAmount?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsUUID()
  costCenterId?: string | null;

  // Advanced/optional per-line classification kept in metadata so no migration
  // is needed: accountId (chart-of-accounts override), clientId/projectId
  // (profitability context), competence (accrual period 'YYYY-MM'), notes, etc.
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

/**
 * Schedule configuration for a payable recurrence. Reused both standalone and
 * embedded in CreateFinanceBillDto.recurrence (where vendor/currency/lines are
 * taken from the bill being created).
 */
export class BillRecurrenceConfigDto {
  @IsEnum(FinanceBillRecurrenceFrequency)
  frequency!: FinanceBillRecurrenceFrequency;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  intervalCount?: number;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  occurrencesLimit?: number | null;

  @IsOptional()
  @IsDateString()
  nextGenerationDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  generationDay?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number | null;

  // Bill has a Draft status, so generated bills default to 'draft' (no posting
  // until confirmed). 'open' would post immediately through the normal flow.
  @IsOptional()
  @IsIn([FinanceBillStatus.Draft, FinanceBillStatus.Open])
  generateAsStatus?: FinanceBillStatus.Draft | FinanceBillStatus.Open;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class FinanceBillRecurrenceLineInputDto {
  @IsString()
  @MaxLength(255)
  description!: string;

  @IsOptional()
  @IsNumberString()
  quantity?: string;

  @IsOptional()
  @IsNumberString()
  unitPrice?: string;

  @IsOptional()
  @IsNumberString()
  taxAmount?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsUUID()
  costCenterId?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateFinanceBillRecurrenceDto extends BillRecurrenceConfigDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsUUID()
  sourceBillId?: string | null;

  @IsOptional()
  @IsUUID()
  vendorId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsUUID()
  costCenterId?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FinanceBillRecurrenceLineInputDto)
  lines!: FinanceBillRecurrenceLineInputDto[];
}

export class UpdateFinanceBillRecurrenceDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsEnum(FinanceBillRecurrenceStatus)
  status?: FinanceBillRecurrenceStatus;

  @IsOptional()
  @IsEnum(FinanceBillRecurrenceFrequency)
  frequency?: FinanceBillRecurrenceFrequency;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  intervalCount?: number;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  occurrencesLimit?: number | null;

  @IsOptional()
  @IsDateString()
  nextGenerationDate?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  generationDay?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number | null;

  @IsOptional()
  @IsIn([FinanceBillStatus.Draft, FinanceBillStatus.Open])
  generateAsStatus?: FinanceBillStatus.Draft | FinanceBillStatus.Open;

  @IsOptional()
  @IsUUID()
  vendorId?: string | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsUUID()
  costCenterId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FinanceBillRecurrenceLineInputDto)
  lines?: FinanceBillRecurrenceLineInputDto[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateFinanceBillDto {
  @IsOptional()
  @IsUUID()
  vendorId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  billNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsDateString()
  issueDate?: string | null;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsDateString()
  periodStart?: string | null;

  @IsOptional()
  @IsDateString()
  periodEnd?: string | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsUUID()
  costCenterId?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FinanceBillLineInputDto)
  lines!: FinanceBillLineInputDto[];

  // When present, the bill is created normally AND a recurrence profile is
  // created from it (vendor/currency/lines snapshotted). The recurrence only
  // generates future bills; it never posts to the ledger directly.
  @IsOptional()
  @ValidateNested()
  @Type(() => BillRecurrenceConfigDto)
  recurrence?: BillRecurrenceConfigDto;
}

export class UpdateFinanceBillDto {
  @IsOptional()
  @IsEnum(FinanceBillStatus)
  status?: FinanceBillStatus;

  @IsOptional()
  @IsUUID()
  vendorId?: string | null;

  @IsOptional()
  @IsDateString()
  issueDate?: string | null;

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class AddFinanceBillLineDto extends FinanceBillLineInputDto {}

export class UpdateFinanceBillLineDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsNumberString()
  quantity?: string;

  @IsOptional()
  @IsNumberString()
  unitPrice?: string;

  @IsOptional()
  @IsNumberString()
  taxAmount?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsUUID()
  costCenterId?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateFinancePaymentDto {
  @IsEnum(FinancePaymentDirection)
  direction!: FinancePaymentDirection;

  @IsOptional()
  @IsEnum(FinancePaymentStatus)
  status?: FinancePaymentStatus;

  @IsOptional()
  @IsEnum(FinancePaymentMethod)
  method?: FinancePaymentMethod;

  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string | null;

  @IsDateString()
  paymentDate!: string;

  @IsNumberString()
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  externalProvider?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  externalReference?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateFinancePaymentDto {
  @IsOptional()
  @IsEnum(FinancePaymentStatus)
  status?: FinancePaymentStatus;

  @IsOptional()
  @IsEnum(FinancePaymentMethod)
  method?: FinancePaymentMethod;

  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string | null;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateFinanceRecurringProfileDto {
  @IsOptional()
  @IsUUID()
  customerId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sourceModule?: string | null;

  @IsOptional()
  @IsUUID()
  sourceId?: string | null;

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsEnum(FinanceRecurringProfileStatus)
  status?: FinanceRecurringProfileStatus;

  @IsOptional()
  @IsEnum(FinanceRecurringInterval)
  interval?: FinanceRecurringInterval;

  @IsNumberString()
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsDateString()
  nextInvoiceDate?: string | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsUUID()
  costCenterId?: string | null;

  @IsOptional()
  @IsBoolean()
  autoGenerateInvoice?: boolean;
}

export class UpdateFinanceRecurringProfileDto {
  @IsOptional()
  @IsEnum(FinanceRecurringProfileStatus)
  status?: FinanceRecurringProfileStatus;

  @IsOptional()
  @IsEnum(FinanceRecurringInterval)
  interval?: FinanceRecurringInterval;

  @IsOptional()
  @IsNumberString()
  amount?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsDateString()
  nextInvoiceDate?: string | null;

  @IsOptional()
  @IsBoolean()
  autoGenerateInvoice?: boolean;
}

export class AllocateFinancePaymentDto {
  @IsEnum(FinanceAllocationTargetType)
  targetType!: FinanceAllocationTargetType;

  @IsUUID()
  targetId!: string;

  @IsNumberString()
  amount!: string;
}
