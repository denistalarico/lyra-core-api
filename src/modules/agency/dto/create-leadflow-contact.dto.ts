import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import type { ContactType } from '../../contacts/entities/contact.entity';

export type LeadFlowContactAddressInput = {
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

export class CreateLeadFlowContactDto {
  @IsIn(['person', 'organization'])
  type!: ContactType;

  @IsString()
  @Length(2, 160)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  instagramUsername?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  phoneLabel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  documentType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  documentNumber?: string;

  @IsOptional()
  @IsObject()
  address?: LeadFlowContactAddressInput;

  // LeadFlow operating context so the contact lands in the client sublist.
  @IsOptional()
  @IsString()
  clientId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  clientName?: string | null;
}
