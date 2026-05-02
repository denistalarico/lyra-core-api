import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { ContactMethodType } from '../entities/contact-method.entity';

export class CreateContactMethodDto {
  @IsIn(['email', 'phone', 'whatsapp', 'instagram', 'website', 'other'])
  type!: ContactMethodType;

  @IsString()
  @MaxLength(255)
  value!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
