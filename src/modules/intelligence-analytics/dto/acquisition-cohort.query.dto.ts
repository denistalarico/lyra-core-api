import { IsString, IsUUID, Matches } from 'class-validator';

/**
 * The query of a cross-domain cohort read.
 *
 * Three fields, and the absences matter more than the presences. There is no
 * tenant, workspace or client field: the scope comes from the authenticated
 * context. The global `ValidationPipe` runs with `forbidNonWhitelisted`, so a
 * request that tried to name one is rejected rather than quietly ignored —
 * which is the behaviour that keeps a future Client Area from being able to ask
 * for another client's funnel by adding a parameter.
 *
 * There is no `channel` filter either. The channel is resolved, not chosen: a
 * caller that could name one would be asking this view to assert a
 * paid-media-to-channel mapping the data does not support.
 */
export class AcquisitionCohortQueryDto {
  /**
   * The ad account to report on.
   *
   * Required, and not for convenience: the account's timezone decides the day
   * boundary applied to *both* domains. Two accounts in different zones have no
   * common day boundary, so a request that named none would have to pick one
   * silently and misstate the other.
   */
  @IsUUID()
  connectionId!: string;

  /** Inclusive first day, in the ad account's own timezone. */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'since must be a date as YYYY-MM-DD.',
  })
  since!: string;

  /** Inclusive last day. */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'until must be a date as YYYY-MM-DD.',
  })
  until!: string;
}
