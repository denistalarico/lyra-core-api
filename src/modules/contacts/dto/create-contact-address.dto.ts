import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { ContactAddressType } from '../entities/contact-address.entity';

export class CreateContactAddressDto {
  @IsOptional()
  @IsIn(['main', 'billing', 'shipping', 'other'])
  type?: ContactAddressType;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  complement?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string;
}
