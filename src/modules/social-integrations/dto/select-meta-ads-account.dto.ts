import { IsString, Matches, MaxLength } from 'class-validator';
import { CANONICAL_AD_ACCOUNT_ID_PATTERN } from '../meta-ad-account-id';

export class SelectMetaAdsAccountDto {
  @IsString()
  @MaxLength(64)
  @Matches(/^[0-9a-fA-F-]{36}$/, {
    message: 'connectionId must be a UUID.',
  })
  connectionId!: string;

  /**
   * Meta ad account handle, e.g. `act_1234567890`. Constrained here so a
   * hostile value never reaches the account lookup or the unique constraint.
   */
  @IsString()
  @MaxLength(180)
  @Matches(CANONICAL_AD_ACCOUNT_ID_PATTERN, {
    message: 'externalAccountId must be a Meta ad account id.',
  })
  externalAccountId!: string;
}
