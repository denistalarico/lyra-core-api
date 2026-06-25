import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumberString,
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
  FinanceAccountStatus,
  FinanceAccountType,
  FinanceBankAccountType,
  FinanceCategoryType,
  FinanceCostBehavior,
  FinanceCostCenterType,
  FinanceJournalType,
} from '../enums';

export class UpdateFinanceSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(3)
  baseCurrency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  fiscalCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  fiscalLocalization?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultPaymentTermsDays?: number;

  @IsOptional()
  @IsString()
  invoiceTerms?: string;

  @IsOptional()
  @IsBoolean()
  pixEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  pixKey?: string | null;

  @IsOptional()
  @IsBoolean()
  autoGenerateRecurringInvoices?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  gracePeriodDays?: number;
}

export class CreateFinanceAccountDto {
  @IsString()
  @MaxLength(40)
  code!: string;

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsEnum(FinanceAccountType)
  type!: FinanceAccountType;

  @IsOptional()
  @IsEnum(FinanceAccountStatus)
  status?: FinanceAccountStatus;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;
}

export class UpdateFinanceAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsEnum(FinanceAccountType)
  type?: FinanceAccountType;

  @IsOptional()
  @IsEnum(FinanceAccountStatus)
  status?: FinanceAccountStatus;

  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;
}

export class CreateFinanceJournalDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsString()
  @MaxLength(40)
  code!: string;

  @IsEnum(FinanceJournalType)
  type!: FinanceJournalType;

  @IsOptional()
  @IsUUID()
  defaultDebitAccountId?: string | null;

  @IsOptional()
  @IsUUID()
  defaultCreditAccountId?: string | null;
}

export class UpdateFinanceJournalDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsEnum(FinanceJournalType)
  type?: FinanceJournalType;

  @IsOptional()
  @IsUUID()
  defaultDebitAccountId?: string | null;

  @IsOptional()
  @IsUUID()
  defaultCreditAccountId?: string | null;
}

export class CreateFinanceCategoryDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsEnum(FinanceCategoryType)
  type!: FinanceCategoryType;

  @IsOptional()
  @IsEnum(FinanceCostBehavior)
  costBehavior?: FinanceCostBehavior | null;

  @IsOptional()
  @IsUUID()
  accountId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  color?: string | null;
}

export class UpdateFinanceCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsEnum(FinanceCategoryType)
  type?: FinanceCategoryType;

  @IsOptional()
  @IsEnum(FinanceCostBehavior)
  costBehavior?: FinanceCostBehavior | null;

  @IsOptional()
  @IsUUID()
  accountId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  color?: string | null;
}

export class CreateFinanceTagDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  color?: string | null;
}

export class CreateFinanceCostCenterDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsEnum(FinanceCostCenterType)
  type?: FinanceCostCenterType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  relatedEntityType?: string | null;

  @IsOptional()
  @IsUUID()
  relatedEntityId?: string | null;
}

export class UpdateFinanceCostCenterDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsEnum(FinanceCostCenterType)
  type?: FinanceCostCenterType;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  relatedEntityType?: string | null;

  @IsOptional()
  @IsUUID()
  relatedEntityId?: string | null;
}

export class FinanceBankDetailsDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  bankCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  branchNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  branchDigit?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  accountNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  accountDigit?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  accountHolderName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  accountHolderDocument?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  iban?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  swiftBic?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  routingNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  internationalAccountNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  localBankIdentifier?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  pixKey?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  pixKeyType?: string | null;
}

export class FinanceCardDetailsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  issuer?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  lastFour?: string | null;

  @IsOptional()
  @IsNumberString()
  creditLimit?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  statementClosingDay?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  paymentDueDay?: number | null;
}

export class CreateFinanceBankAccountDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsEnum(FinanceBankAccountType)
  type?: FinanceBankAccountType;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  bankName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string | null;

  @IsOptional()
  @IsUUID()
  accountId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  externalReference?: string | null;

  @IsOptional()
  @IsNumberString()
  openingBalance?: string;

  @IsOptional()
  @IsDateString()
  initialBalanceDate?: string | null;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  reconciliationEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => FinanceBankDetailsDto)
  bankDetails?: FinanceBankDetailsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FinanceCardDetailsDto)
  cardDetails?: FinanceCardDetailsDto;
}

export class UpdateFinanceBankAccountDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsEnum(FinanceBankAccountType)
  type?: FinanceBankAccountType;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  bankName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  countryCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  externalReference?: string | null;

  @IsOptional()
  @IsNumberString()
  openingBalance?: string;

  @IsOptional()
  @IsDateString()
  initialBalanceDate?: string | null;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  reconciliationEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => FinanceBankDetailsDto)
  bankDetails?: FinanceBankDetailsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FinanceCardDetailsDto)
  cardDetails?: FinanceCardDetailsDto;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateFinanceProfitabilityRulesDto {
  @IsOptional()
  @IsNumberString()
  defaultHourlyCost?: string;

  @IsOptional()
  @IsNumberString()
  healthyMarginThreshold?: string;

  @IsOptional()
  @IsNumberString()
  attentionMarginThreshold?: string;

  @IsOptional()
  @IsNumberString()
  riskMarginThreshold?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  overheadAllocationMethod?: string;

  @IsOptional()
  @IsBoolean()
  includeFixedCostsInClientMargin?: boolean;

  @IsOptional()
  @IsBoolean()
  includeTeamTimeCosts?: boolean;
}

export class FinanceMetricsHistoryQueryDto {
  @IsOptional()
  @IsString()
  metricKey?: string;

  @IsOptional()
  @IsString()
  periodType?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
