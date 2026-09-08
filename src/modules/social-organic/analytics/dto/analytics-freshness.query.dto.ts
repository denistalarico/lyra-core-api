import { IsUUID } from 'class-validator';

/**
 * The query of an organic freshness read: one asset, no period.
 *
 * Mirrors `social-integrations/dto/analytics-freshness.query.dto.ts`, with
 * `assetId` in place of `connectionId`. There is no date range because the
 * question is "how current is everything we hold for this asset?", not a
 * question about a window.
 */
export class AnalyticsFreshnessQueryDto {
  @IsUUID()
  assetId!: string;
}
