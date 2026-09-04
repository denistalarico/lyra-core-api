import { IsIn, IsString, IsUUID, Matches } from 'class-validator';
import type { ObservedAttributionGroupBy } from '../observed-attribution-summary.contract';

/**
 * The four levels a summary may be grouped by.
 *
 * Declared as a runtime array because `@IsIn` needs values, not a type. The
 * cast at the end of the class keeps the compiler checking that the two agree,
 * so adding a level to the contract without adding it here fails to build.
 *
 * `destination` is deliberately not offered — see
 * `OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_LIMITATION`.
 */
export const OBSERVED_ATTRIBUTION_GROUP_BY = [
  'account',
  'campaign',
  'adset',
  'ad',
] as const;

/**
 * The query of an observed-attribution summary.
 *
 * The absences are the security property. There is no tenant, workspace or
 * client field: scope comes from the authenticated context, and the global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so a request that tried to
 * name one is rejected rather than quietly ignored. That is what keeps a future
 * Client Area from reading another client's funnel by adding a parameter.
 *
 * There is no channel or provider filter either. Both are resolved from the
 * evidence — a caller that could name one would be asking this view to assert a
 * mapping the data does not support.
 */
export class ObservedAttributionSummaryQueryDto {
  /**
   * The ad account to report on. Required, and not for convenience.
   *
   * Two reasons, both correctness. The account's timezone decides where the
   * window's days begin, and two accounts in different zones have no common
   * boundary — so a request naming none would have to pick one silently and
   * misstate the other. And an ad id is unique only within a Business: naming
   * the connection is what makes the hierarchy lookup unambiguous instead of
   * fail-closed.
   */
  @IsUUID()
  connectionId!: string;

  /** Inclusive first day, in the ad account's own timezone. */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'from must be a date as YYYY-MM-DD.',
  })
  from!: string;

  /** Inclusive last day, same zone. */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'until must be a date as YYYY-MM-DD.',
  })
  until!: string;

  /** Which hierarchy level the groups name. */
  @IsIn(OBSERVED_ATTRIBUTION_GROUP_BY)
  groupBy!: ObservedAttributionGroupBy;
}
