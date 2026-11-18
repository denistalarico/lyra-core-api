import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  FinanceBrazilTaxRegime,
  FinanceFiscalDocumentModel,
  FinanceIbsCbsOperationType,
  FinanceServiceCityOrigin,
} from '../enums';

export class UpdateFinanceFiscalProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(2)
  fiscalCountry?: string;

  @IsOptional()
  @IsEnum(FinanceFiscalDocumentModel)
  defaultDocumentModel?: FinanceFiscalDocumentModel;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  municipalRegistration?: string | null;

  @IsOptional()
  @IsBoolean()
  isSimplesNacional?: boolean;

  @IsOptional()
  @IsEnum(FinanceBrazilTaxRegime)
  brazilTaxRegime?: FinanceBrazilTaxRegime;

  @IsOptional()
  @IsBoolean()
  hasSpecialTaxRegime?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  specialTaxRegimeCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  nfseSeries?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  nextRpsNumber?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  nextBatchNumber?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  cnae?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  cityServiceCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  cityTaxationCode?: string | null;

  @IsOptional()
  @IsNumberString()
  issRate?: string;

  @IsOptional()
  @IsString()
  cityServiceDescription?: string | null;

  @IsOptional()
  @IsEnum(FinanceServiceCityOrigin)
  serviceCityOrigin?: FinanceServiceCityOrigin;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  defaultNbsCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  nationalServiceCode?: string | null;

  @IsOptional()
  @IsBoolean()
  hasIssImmunity?: boolean;

  // F5 (2026-11-17): the certificate fields are no longer writable here. The
  // A1 only arrives through the accountant link (fiscal-intake), encrypted
  // with FISCAL_CERT_ENCRYPTION_KEY, and is never read back by the API.

  @IsOptional()
  @IsBoolean()
  isPersonalOperation?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  operationIndicatorCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  ibsCbsCct?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  ibsCbsCst?: string | null;

  @IsOptional()
  @IsNumberString()
  ibsMunicipalRate?: string;

  @IsOptional()
  @IsNumberString()
  ibsStateRate?: string;

  @IsOptional()
  @IsNumberString()
  cbsRate?: string;

  @IsOptional()
  @IsEnum(FinanceIbsCbsOperationType)
  ibsCbsOperationType?: FinanceIbsCbsOperationType;

  @IsOptional()
  @IsNumberString()
  deferralStatePercent?: string;

  @IsOptional()
  @IsNumberString()
  deferralMunicipalPercent?: string;

  @IsOptional()
  @IsNumberString()
  deferralCbsPercent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  fiscalProvider?: string | null;

  @IsOptional()
  @IsObject()
  providerConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
