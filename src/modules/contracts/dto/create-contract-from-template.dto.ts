import {
  IsBoolean,
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateContractFromTemplateDto {
  @IsUUID()
  templateId!: string;

  @IsOptional()
  @IsUUID()
  templateVersionId?: string | null;

  @IsString()
  @MaxLength(180)
  title!: string;

  @IsOptional()
  @IsUUID()
  targetId?: string | null;

  @IsObject()
  variablesData!: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  validFrom?: string | null;

  @IsOptional()
  @IsDateString()
  validUntil?: string | null;

  @IsOptional()
  @IsBoolean()
  generateHtml?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
