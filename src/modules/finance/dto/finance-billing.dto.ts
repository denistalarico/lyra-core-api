import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  FinanceAllocationTargetType,
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
