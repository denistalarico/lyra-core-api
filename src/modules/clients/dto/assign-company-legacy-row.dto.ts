import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * CC2G — the body of a manual legacy assignment.
 *
 * There is deliberately no `agencyClientId` here. The commercial account is
 * resolved by the backend from the Company Context and the row's persisted
 * scope; accepting it from the body would let the caller assert an ownership
 * the server is supposed to prove.
 */
export class AssignCompanyLegacyRowDto {
  @IsUUID()
  companyContextId!: string;

  /** Mandatory: the audit trail is worthless without the operator's rationale. */
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}

export class ListCompanyLegacyRowsQueryDto {
  @IsOptional()
  @IsUUID()
  agencyClientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  domainKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  product?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  offset?: string;
}
