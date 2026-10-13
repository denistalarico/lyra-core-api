import { IsIn, IsString, MaxLength } from 'class-validator';
import type { ContactLookupCountry } from '../agency-contact-lookup.service';

const LOOKUP_COUNTRIES: ContactLookupCountry[] = ['BR', 'US'];

/**
 * The browser resolves the free-text address country to BR/US before asking;
 * the country is never inferred here from the identifier's length.
 */
export class AgencyContactPostalLookupDto {
  @IsIn(LOOKUP_COUNTRIES)
  country!: ContactLookupCountry;

  @IsString()
  @MaxLength(20)
  postalCode!: string;
}

export class AgencyContactCompanyLookupDto {
  @IsIn(LOOKUP_COUNTRIES)
  country!: ContactLookupCountry;

  @IsString()
  @MaxLength(30)
  document!: string;
}
