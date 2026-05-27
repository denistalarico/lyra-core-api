import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FinanceJournalEntryLineType } from '../enums';

export class CreateFinanceJournalEntryLineDto {
  @IsEnum(FinanceJournalEntryLineType)
  lineType!: FinanceJournalEntryLineType;

  @IsOptional()
  @IsUUID()
  accountId?: string | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  @IsOptional()
  @IsUUID()
  costCenterId?: string | null;

  @IsOptional()
  @IsUUID()
  contactId?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsNumberString()
  amount!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateFinanceJournalEntryDto {
  @IsDateString()
  entryDate!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUUID()
  journalId?: string | null;

  @IsOptional()
  @IsString()
  sourceModule?: string | null;

  @IsOptional()
  @IsUUID()
  sourceId?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => CreateFinanceJournalEntryLineDto)
  lines!: CreateFinanceJournalEntryLineDto[];
}
