import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
class ContractIndexPeriodDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) start!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) end!: string;
}
export class RenewContractDto {
  @IsIn(['same', 'custom']) periodMode!: 'same' | 'custom';
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validFrom?: string;
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validUntil?: string;
  @IsIn(['keep', 'percent', 'custom']) valueMode!:
    | 'keep'
    | 'percent'
    | 'custom';
  @IsOptional()
  @IsIn(['ipca', 'igpm', 'cpi', 'fixed_percentage', 'other'])
  adjustmentIndex?: 'ipca' | 'igpm' | 'cpi' | 'fixed_percentage' | 'other';
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(-99.9999)
  @Max(1000)
  adjustmentPercent?: number;
  @IsOptional() @IsIn(['manual', 'bcb_sgs']) adjustmentSource?:
    | 'manual'
    | 'bcb_sgs';
  @IsOptional()
  @ValidateNested()
  @Type(() => ContractIndexPeriodDto)
  indexPeriod?: ContractIndexPeriodDto;
  @IsOptional()
  @IsString()
  @Matches(/^\d+(?:\.\d{1,4})?$/)
  @MaxLength(30)
  monthlyValue?: string;
  @IsOptional() @IsString() @MaxLength(180) title?: string;
  @IsOptional() @IsString() @MaxLength(4000) note?: string;
}
