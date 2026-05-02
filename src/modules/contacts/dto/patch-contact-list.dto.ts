import {
  IsHexColor,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import type { ContactListVisibility } from '../entities/contact-list.entity';

export class PatchContactListDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsIn(['private', 'workspace'])
  visibility?: ContactListVisibility;
}
