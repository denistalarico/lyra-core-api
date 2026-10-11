import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ContractDocumentKind } from '../enums';
class ContractTermChangesDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d+(?:\.\d{1,4})?$/)
  @MaxLength(30)
  monthlyValue?: string;
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validUntil?: string;
}
export class CreateContractTermDto {
  @IsIn(['amendment', 'settlement', 'termination']) kind!:
    | ContractDocumentKind.Amendment
    | ContractDocumentKind.Settlement
    | ContractDocumentKind.Termination;
  @IsOptional() @IsUUID() templateId?: string;
  @IsOptional() @IsString() @MaxLength(180) title?: string;
  @IsOptional() @IsObject() variablesData?: Record<string, unknown>;
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveDate?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => ContractTermChangesDto)
  changes?: ContractTermChangesDto;
  @IsOptional() @IsBoolean() generateHtml?: boolean;
}
