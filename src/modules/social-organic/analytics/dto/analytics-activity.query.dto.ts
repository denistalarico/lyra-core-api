import { IsUUID } from 'class-validator';

/**
 * The query of a follower-activity read.
 *
 * One field, and the absence of a period is the contract rather than an
 * omission. Meta serves roughly the last 30 days of `online_followers` whatever
 * range is asked for, so a `since`/`until` pair could only be honoured by
 * filtering a window that is already all there is — letting a report request
 * June and be handed September's grid under June's heading. The response says
 * which days it averaged instead.
 *
 * No tenant, workspace or client field: scope comes from the authenticated
 * context, and the global `ValidationPipe` runs with `forbidNonWhitelisted`, so
 * a query naming one is rejected outright.
 */
export class AnalyticsActivityQueryDto {
  @IsUUID()
  assetId!: string;
}
