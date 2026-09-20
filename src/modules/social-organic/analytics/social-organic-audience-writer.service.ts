import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { NormalizedOrganicAudienceDaily } from './social-organic-audience.contract';

/**
 * Rows per statement.
 *
 * A city dimension can hold hundreds of buckets for one asset on one day, so
 * this writer batches where `SocialOrganicMetricsWriterService` writes row by
 * row — that one handles at most a few rows per sync and its per-row loop costs
 * nothing. Each row binds twelve parameters, so 200 is 2 400 of the 65 535
 * Postgres allows.
 */
const CHUNK_SIZE = 200;

/**
 * Writes organic audience snapshots.
 *
 * The only component that touches `social_organic_audience_daily`, and it does
 * one thing to it: upsert normalized rows on their identity.
 *
 * No delete. A bucket Meta stopped reporting is not evidence that the audience
 * left it — Meta suppresses buckets below a privacy threshold, so a city that
 * disappears from one snapshot may reappear in the next with the same followers
 * behind it. Deleting on absence would turn a suppression into a story about
 * churn. Each day's snapshot stands on its own, and the read takes the newest.
 *
 * The whole batch writes in one transaction, so one asset's snapshot of one day
 * is all-or-nothing: a half-written distribution would be read as a real one,
 * with its remaining buckets summing to an audience that never existed.
 */
@Injectable()
export class SocialOrganicAudienceWriterService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async upsert(
    rows: readonly NormalizedOrganicAudienceDaily[],
  ): Promise<number> {
    if (!rows.length) return 0;

    return this.dataSource.transaction(async (manager) => {
      let written = 0;

      for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
        const chunk = rows.slice(index, index + CHUNK_SIZE);
        const params: unknown[] = [];
        const tuples: string[] = [];

        for (const row of chunk) {
          const base = params.length;

          params.push(
            row.tenantId,
            row.workspaceId,
            row.agencyClientId,
            row.assetId,
            row.provider,
            row.metricDate,
            row.assetTimezone,
            row.breakdownKind,
            row.breakdownKey,
            row.value,
            row.observedAt,
            row.syncedAt,
            row.syncRunId,
          );

          tuples.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
              `$${base + 6}::date, $${base + 7}, $${base + 8}, $${base + 9}, ` +
              `$${base + 10}::numeric, $${base + 11}, $${base + 12}, $${base + 13})`,
          );
        }

        await manager.query(
          `INSERT INTO social_organic_audience_daily (
             tenant_id, workspace_id, agency_client_id, asset_id, provider,
             metric_date, asset_timezone, breakdown_kind, breakdown_key,
             value, observed_at, synced_at, sync_run_id
           ) VALUES ${tuples.join(', ')}
           ON CONFLICT (asset_id, metric_date, breakdown_kind, breakdown_key)
           DO UPDATE SET
             agency_client_id = EXCLUDED.agency_client_id,
             provider = EXCLUDED.provider,
             asset_timezone = EXCLUDED.asset_timezone,
             value = EXCLUDED.value,
             observed_at = EXCLUDED.observed_at,
             synced_at = EXCLUDED.synced_at,
             sync_run_id = EXCLUDED.sync_run_id,
             updated_at = now()`,
          params,
        );

        written += chunk.length;
      }

      return written;
    });
  }
}
