import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export const CONTACT_COMPANY_LINK_ROLES = [
  'owner',
  'legal_representative',
  'employee',
  'billing',
  'primary_contact',
  'other',
] as const;

export type ContactCompanyLinkRole =
  (typeof CONTACT_COMPANY_LINK_ROLES)[number];

export class UpdateContactCompanyLinkDto {
  @IsOptional()
  @IsIn(CONTACT_COMPANY_LINK_ROLES)
  role?: ContactCompanyLinkRole | null;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsIn(['active', 'inactive', 'archived'])
  status?: 'active' | 'inactive' | 'archived';
}
