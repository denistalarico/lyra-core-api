import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { NormalizedOrganicOnlineFollowers } from './social-organic-online-followers.contract';

/**
 * Rows per statement.
 *
 * A 30-day window is 30 × 24 = 720 rows in one pass, so this batches for the
 * same reason the audience writer does. Each row binds thirteen parameters, so
 * 200 is 2 600 of the 65 535 Postgres allows.
 */
const CHUNK_SIZE = 200;

/**
 * Writes the online-followers grid.
 *
 * The only component that touches `social_organic_online_followers`, and it
 * does one thing to it: upsert normalized rows on `(asset, day, hour)`.
 *
 * No delete, for the audience writer's reason applied to a different shape: an
 * hour Meta stops reporting is not an hour in which nobody was online. Each
 * reading stands on its own, and a re-read of a day Meta has revised replaces
 * that day's hours rather than accumulating beside them.
 *
 * One transaction for the whole batch, so a window is all-or-nothing: a
 * half-written grid would be read as a real one, and the "melhor horário" chart
 * would confidently recommend whichever hour happened to be written last.
 */
@Injectable()
export class SocialOrganicOnlineFollowersWriterService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async upsert(
    rows: readonly NormalizedOrganicOnlineFollowers[],
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
            row.hourOfDay,
            row.assetTimezone,
            row.sourceTimezone,
            row.followersOnline,
            row.observedAt,
            row.syncedAt,
            row.syncRunId,
          );

          tuples.push(
            `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
              `$${base + 6}::date, $${base + 7}::smallint, $${base + 8}, $${base + 9}, ` +
              `$${base + 10}::bigint, $${base + 11}, $${base + 12}, $${base + 13})`,
          );
        }

        await manager.query(
          `INSERT INTO social_organic_online_followers (
             tenant_id, workspace_id, agency_client_id, asset_id, provider,
             metric_date, hour_of_day, asset_timezone, source_timezone,
             followers_online, observed_at, synced_at, sync_run_id
           ) VALUES ${tuples.join(', ')}
           ON CONFLICT (asset_id, metric_date, hour_of_day)
           DO UPDATE SET
             agency_client_id = EXCLUDED.agency_client_id,
             provider = EXCLUDED.provider,
             asset_timezone = EXCLUDED.asset_timezone,
             source_timezone = EXCLUDED.source_timezone,
             followers_online = EXCLUDED.followers_online,
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
