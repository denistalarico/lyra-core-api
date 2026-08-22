import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import type { ContactMethodType } from '../entities/contact-method.entity';

export class PatchContactMethodDto {
  @IsOptional()
  @IsIn([
    'email',
    'phone',
    'whatsapp',
    'instagram',
    'facebook',
    'tiktok',
    'website',
    'other',
  ])
  type?: ContactMethodType;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  value?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string | null;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
