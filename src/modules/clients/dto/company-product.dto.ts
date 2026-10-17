import { Equals, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { CompanyRemovalMode } from '../entities/agency-client-company-product.entity';

export class RemoveCompanyProductDto {
  @IsIn(['immediate', 'after_last_publication']) mode!: CompanyRemovalMode;
  @Equals(true) confirm!: true;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class ArchiveClientProductsDto {
  @IsOptional()
  @IsIn(['immediate', 'after_last_publication'])
  mode?: CompanyRemovalMode;
}

export class CompanyProductActionDto {
  @IsOptional()
  @Equals(true)
  confirm?: true;
}
