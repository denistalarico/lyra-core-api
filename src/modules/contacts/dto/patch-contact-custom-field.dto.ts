import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import type { ContactCustomFieldType } from '../entities/contact-custom-field.entity';

export class PatchContactCustomFieldDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(2, 80)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message:
      'key must start with a lowercase letter and contain only lowercase letters, numbers and underscores',
  })
  key?: string;

  @IsOptional()
  @IsIn(['text', 'number', 'boolean', 'date', 'select', 'multiselect'])
  type?: ContactCustomFieldType;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsObject()
  options?: Record<string, unknown> | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
