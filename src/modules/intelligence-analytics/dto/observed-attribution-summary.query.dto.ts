import { IsIn, IsString, IsUUID, Matches } from 'class-validator';
import type { ObservedAttributionGroupBy } from '../observed-attribution-summary.contract';

/**
 * The axes a summary may be grouped by.
 *
 * Declared as a runtime array because `@IsIn` needs values, not a type. The
 * annotation on `groupBy` keeps the compiler checking that the two agree, so
 * adding a level to the contract without adding it here fails to build.
 *
 * The first four are Meta's hierarchy and partition the matched cohort.
 * `destination` (I4.3) is an orthogonal axis and does not: a conversation whose
 * ad set was re-pointed between two of its own clicks belongs to no single
 * destination and is reported in `destinationCoverage` instead of being placed
 * in a bucket.
 */
export const OBSERVED_ATTRIBUTION_GROUP_BY = [
  'account',
  'campaign',
  'adset',
  'ad',
  'destination',
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

  /** Which axis the groups name — a hierarchy level, or the destination. */
  @IsIn(OBSERVED_ATTRIBUTION_GROUP_BY)
  groupBy!: ObservedAttributionGroupBy;
}
