import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  FinancePaymentProviderEnvironment,
  FinancePaymentProviderStatus,
  FinancePaymentProviderType,
} from '../enums';

export class CreateFinancePaymentProviderDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsEnum(FinancePaymentProviderType)
  providerType!: FinancePaymentProviderType;

  @IsOptional()
  @IsEnum(FinancePaymentProviderEnvironment)
  environment?: FinancePaymentProviderEnvironment;

  @IsOptional()
  @IsBoolean()
  isDefaultForCustomerPayments?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefaultForVendorPayments?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsPix?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsCard?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsBoleto?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsBankSlip?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsBankTransfer?: boolean;

  @IsOptional()
  @IsString()
  publicKey?: string | null;

  @IsOptional()
  @IsString()
  secretKeyEncrypted?: string | null;

  @IsOptional()
  @IsString()
  accessTokenEncrypted?: string | null;

  @IsOptional()
  @IsString()
  refreshTokenEncrypted?: string | null;

  @IsOptional()
  @IsString()
  webhookSecretEncrypted?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  externalAccountId?: string | null;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateFinancePaymentProviderDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEnum(FinancePaymentProviderStatus)
  status?: FinancePaymentProviderStatus;

  @IsOptional()
  @IsEnum(FinancePaymentProviderEnvironment)
  environment?: FinancePaymentProviderEnvironment;

  @IsOptional()
  @IsBoolean()
  isDefaultForCustomerPayments?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefaultForVendorPayments?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsPix?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsCard?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsBoleto?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsBankSlip?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsBankTransfer?: boolean;

  @IsOptional()
  @IsString()
  publicKey?: string | null;

  @IsOptional()
  @IsString()
  secretKeyEncrypted?: string | null;

  @IsOptional()
  @IsString()
  accessTokenEncrypted?: string | null;

  @IsOptional()
  @IsString()
  refreshTokenEncrypted?: string | null;

  @IsOptional()
  @IsString()
  webhookSecretEncrypted?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  externalAccountId?: string | null;

  @IsOptional()
  @IsString()
  lastHealthCheckStatus?: string | null;

  @IsOptional()
  @IsString()
  lastErrorMessage?: string | null;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
