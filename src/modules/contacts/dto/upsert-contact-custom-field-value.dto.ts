import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class UpsertContactCustomFieldValueDto {
  @IsUUID()
  fieldId!: string;

  @IsOptional()
  @IsString()
  valueText?: string | null;

  @IsOptional()
  @IsNumber()
  valueNumber?: number | null;

  @IsOptional()
  @IsBoolean()
  valueBoolean?: boolean | null;

  @IsOptional()
  @IsDateString()
  valueDate?: string | null;

  @IsOptional()
  @IsObject()
  valueJson?: Record<string, unknown> | null;
}
