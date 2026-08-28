import { IsUUID } from 'class-validator';

/**
 * The query of a freshness read: one connection, no period.
 *
 * There is no date range because the question is not about a window — it is
 * "how current is everything we hold for this account, and where is its backfill
 * up to?". A period would only limit the answer to something the caller already
 * knows.
 */
export class AnalyticsFreshnessQueryDto {
  @IsUUID()
  connectionId!: string;
}
