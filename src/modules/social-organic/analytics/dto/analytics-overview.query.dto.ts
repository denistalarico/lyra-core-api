import { IsString, IsUUID, Matches } from 'class-validator';

/**
 * The query of an organic analytics overview/timeseries read.
 *
 * Mirrors `social-integrations/dto/analytics-overview.query.dto.ts` exactly,
 * with `assetId` in place of `connectionId` — organic analytics identifies
 * its picker unit as an asset (a Page/IG account), not a connection. No
 * tenant, workspace or client field: the scope comes from the authenticated
 * context, and the global `ValidationPipe` runs with `forbidNonWhitelisted`,
 * so a query naming one is rejected outright.
 */
export class AnalyticsOverviewQueryDto {
  @IsUUID()
  assetId!: string;

  /**
   * Inclusive first day, in the asset's own timezone. A bare `YYYY-MM-DD`,
   * never an instant — an instant would carry the sender's timezone and shift
   * the whole period by a day for any asset far enough from the browser's
   * clock.
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
