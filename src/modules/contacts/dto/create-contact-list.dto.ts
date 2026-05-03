import {
  IsHexColor,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import type { ContactListVisibility } from '../entities/contact-list.entity';

export class CreateContactListDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsUUID()
  parentListId?: string | null;

  @IsOptional()
  @IsIn(['private', 'workspace'])
  visibility?: ContactListVisibility;
}
