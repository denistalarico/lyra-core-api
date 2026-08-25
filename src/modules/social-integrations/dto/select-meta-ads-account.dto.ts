import { IsString, Matches, MaxLength } from 'class-validator';

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
  @Matches(/^act_[0-9]{1,32}$/, {
    message: 'externalAccountId must be a Meta ad account id.',
  })
  externalAccountId!: string;
}
