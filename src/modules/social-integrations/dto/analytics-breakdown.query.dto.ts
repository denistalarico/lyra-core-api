import { IsIn, IsString, IsUUID, Matches } from 'class-validator';
import type { SocialAdBreakdownKind } from '../entities/social-ad-breakdown-daily.entity';

/**
 * The dimensions a caller may ask for.
 *
 * A closed list, validated here and then used to index closed lookups in the
 * read service and the label module — nothing the caller sends reaches SQL or a
 * Graph parameter as text. It mirrors `SocialAdBreakdownKind`, and the
 * `satisfies` below is what makes a value added to one but not the other a
 * compile error rather than a request that validates and then matches no rows.
 */
const BREAKDOWN_KINDS = [
  'age_gender',
  'device_platform',
  'publisher_platform',
  'hourly',
] as const satisfies readonly SocialAdBreakdownKind[];

/**
 * The query of a breakdown read.
 *
 * Four fields and no fifth. There is deliberately no tenant, workspace or client
 * field: the scope comes from the authenticated context, and the global
 * `ValidationPipe` runs with `forbidNonWhitelisted`, so a query that tried to
 * name one is rejected outright rather than quietly ignored.
 *
 * Also absent: `entityLevel`. The ingest writes account level and the read pins
 * it, and a caller able to name a level could ask for one that holds a partition
 * of the same money at a finer grain — which would be a different, larger number
 * presented under the same label.
 */
export class AnalyticsBreakdownQueryDto {
  @IsUUID()
  connectionId!: string;

  @IsIn(BREAKDOWN_KINDS)
  kind!: SocialAdBreakdownKind;

  /**
   * Inclusive first day, in the ad account's own timezone.
   *
   * A bare `YYYY-MM-DD`, never an instant. A datetime would arrive carrying the
   * sender's timezone, and applying it would shift the whole period by a day for
   * any account far enough from the browser's clock.
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
