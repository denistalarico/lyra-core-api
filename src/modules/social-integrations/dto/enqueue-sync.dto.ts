import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * The body of an enqueue request: a window, or nothing.
 *
 * Two optional fields and no third. The window is what turns the run from a
 * hierarchy refresh into a full sync, so it is the only thing a caller decides;
 * everything else — which levels, which segments, which attribution setting —
 * is a property of the pipeline and not a request parameter.
 *
 * Nothing here names a scope. Tenant, workspace and managed client come from
 * the authenticated context, and the global `ValidationPipe` runs with
 * `forbidNonWhitelisted`, so a body that tries to carry one is rejected rather
 * than ignored. That matters more here than on a synchronous endpoint: a run is
 * a stored instruction that a worker executes later, without a request context
 * to check it against.
 */
export class EnqueueSyncDto {
  /**
   * Inclusive first day, in the ad account's own timezone.
   *
   * A bare `YYYY-MM-DD`, never an instant. A datetime would arrive carrying the
   * sender's timezone, and applying it would shift the whole window by a day
   * for any account far enough from the browser's clock.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'since must be a date as YYYY-MM-DD.',
  })
  since?: string;

  /** Inclusive last day. Must be a day the ad account has already finished. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'until must be a date as YYYY-MM-DD.',
  })
  until?: string;
}
