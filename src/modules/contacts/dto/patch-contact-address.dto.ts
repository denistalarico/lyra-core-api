import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { ContactAddressType } from '../entities/contact-address.entity';

export class PatchContactAddressDto {
  @IsOptional()
  @IsIn(['main', 'billing', 'shipping', 'other'])
  type?: ContactAddressType;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  street?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  number?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  complement?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  district?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  postalCode?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string | null;
}
