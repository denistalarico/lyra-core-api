import { IsObject, IsOptional, IsString } from 'class-validator';

export class GenerateContractHtmlDto {
  @IsOptional()
  @IsObject()
  variablesData?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  note?: string | null;
}
