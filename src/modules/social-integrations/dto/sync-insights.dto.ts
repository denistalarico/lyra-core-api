import { IsString, Matches } from 'class-validator';

/**
 * The window one manual ingest covers.
 *
 * Shape only, and deliberately narrow: `YYYY-MM-DD` and nothing else. An
 * instant would carry a timezone, and the caller's timezone is not the one that
 * defines a Meta reporting day — the ad account's is. Accepting one here would
 * mean choosing, somewhere downstream, whose midnight to believe.
 *
 * Whether the dates are real, ordered and inside the allowed span is not a
 * question this class can answer well; `parseInsightsWindow` does it, and this
 * validator passing means only "these are two date-shaped strings".
 *
 * There is deliberately no scope field. Tenant, workspace and managed client
 * come from the authenticated context, and the global `ValidationPipe` runs
 * with `forbidNonWhitelisted`, so a body that tried to name one is rejected
 * outright rather than quietly ignored.
 */
export class SyncInsightsDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'since must be a date as YYYY-MM-DD.',
  })
  since!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'until must be a date as YYYY-MM-DD.',
  })
  until!: string;
}
