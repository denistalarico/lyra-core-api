import { IsObject, IsOptional, IsString } from 'class-validator';

export class PreviewContractTemplateDto {
  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsString()
  headerHtml?: string | null;

  @IsString()
  bodyHtml!: string;

  @IsOptional()
  @IsString()
  footerHtml?: string | null;

  @IsOptional()
  @IsObject()
  variablesData?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  title?: string;
}
