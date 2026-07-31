import {
  IsDateString,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateFinanceBankTransferDto {
  @IsUUID()
  fromBankAccountId!: string;

  @IsUUID()
  toBankAccountId!: string;

  @IsDateString()
  transferDate!: string;

  @IsNumberString()
  amount!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
