import { IsEnum, IsOptional } from 'class-validator';
import { ContractDocumentType } from '../enums';
export class ListContractDocumentsQueryDto {
  @IsOptional() @IsEnum(ContractDocumentType) type?: ContractDocumentType;
}
