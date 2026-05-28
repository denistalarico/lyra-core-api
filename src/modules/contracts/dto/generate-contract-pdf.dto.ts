import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class GenerateContractPdfDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  fileName?: string;

  @IsOptional()
  @IsBoolean()
  generateHtmlIfMissing?: boolean;

  @IsOptional()
  @IsIn(['A4', 'Letter', 'Legal'])
  format?: 'A4' | 'Letter' | 'Legal';

  @IsOptional()
  @IsBoolean()
  printBackground?: boolean;

  @IsOptional()
  @IsBoolean()
  includeBase64?: boolean;

  @IsOptional()
  @IsString()
  marginTop?: string;

  @IsOptional()
  @IsString()
  marginRight?: string;

  @IsOptional()
  @IsString()
  marginBottom?: string;

  @IsOptional()
  @IsString()
  marginLeft?: string;

  @IsOptional()
  @IsString()
  note?: string | null;
}
