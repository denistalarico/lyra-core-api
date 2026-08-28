import { IsString, IsUUID, Matches } from 'class-validator';

/**
 * The query of an analytics overview read.
 *
 * Three fields and no fourth. There is deliberately no tenant, workspace or
 * client field: the scope comes from the authenticated context, and the global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so a query that tried to
 * name one is rejected outright rather than quietly ignored. A readable scope
 * parameter on a reporting endpoint is how one client's ad spend ends up on
 * another client's dashboard.
 *
 * There is also no comparison window. The previous period is derived — same
 * length, immediately preceding — because a caller able to name both sides could
 * compare a month against a day and label the difference growth.
 *
 * Whether the dates are real, ordered and inside the allowed span is not a
 * question this class answers well; `parseAnalyticsPeriod` does it. This
 * validator passing means only "a uuid and two date-shaped strings".
 */
export class AnalyticsOverviewQueryDto {
  @IsUUID()
  connectionId!: string;

  /**
   * Inclusive first day, in the ad account's own timezone.
   *
   * A bare `YYYY-MM-DD`, never an instant. A datetime would arrive carrying the
   * sender's timezone, and applying it would shift the whole period by a day for
   * any account far enough from the browser's clock — returning real numbers for
   * the wrong days, which is worse than an error.
   */
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
