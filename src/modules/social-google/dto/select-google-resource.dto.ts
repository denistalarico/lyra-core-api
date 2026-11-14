import { Matches } from 'class-validator';

export class SelectGoogleAdsAccountDto {
  /** Customer id without hyphens. Must come from the current listing. */
  @Matches(/^\d{10}$/)
  customerId!: string;
}

export class SelectGa4PropertyDto {
  /** Numeric GA4 property id. Must come from the current listing. */
  @Matches(/^\d{1,20}$/)
  propertyId!: string;
}
