import { IsString, Matches, MaxLength } from 'class-validator';
import { CANONICAL_AD_ACCOUNT_ID_PATTERN } from '../meta-ad-account-id';

/**
 * The internal path has no in-flight connection to reference: the account
 * handle is the only thing the caller supplies. Same constraint as the OAuth
 * selection, for the same reason — a hostile value must not reach the account
 * lookup or the unique constraint.
 *
 * Shape only. Which account is permitted is not a question a DTO can answer:
 * the service checks the value against configuration, and this validator
 * passing means nothing more than "this is an ad account id".
 */
export class SelectInternalAdAccountDto {
  @IsString()
  @MaxLength(180)
  @Matches(CANONICAL_AD_ACCOUNT_ID_PATTERN, {
    message: 'externalAccountId must be a Meta ad account id.',
  })
  externalAccountId!: string;
}
