import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class ContractAiAssistCategoryOptionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  value!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  label!: string;
}

export class ContractAiAssistDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  sourceText?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  sourceHtml?: string;

  @IsIn(['client'])
  targetType!: 'client';

  @ValidateIf((_object, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ContractAiAssistCategoryOptionDto)
  categoryOptions?: ContractAiAssistCategoryOptionDto[];
}
