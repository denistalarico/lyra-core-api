import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  Min,
  Max,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class FinanceReceivableWriteOffQueryDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;
  @IsOptional() @IsIn(['active', 'reversed']) status?: 'active' | 'reversed';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class CreateFinanceReceivableWriteOffDto {
  @Matches(/^\d{1,12}(\.\d{1,2})?$/)
  amount!: string;
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  writeOffDate!: string;
  @IsString()
  @MaxLength(2000)
  reason!: string;
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  evidence?: string | null;
  @IsUUID()
  expenseAccountId!: string;
  @IsUUID()
  idempotencyKey!: string;
}

export class ReverseFinanceReceivableWriteOffDto {
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  reversalDate!: string;
  @IsString()
  @MaxLength(2000)
  reason!: string;
}
