import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { SocialAdBreakdownDailyEntity } from '../entities/social-ad-breakdown-daily.entity';
import type { NormalizedAdBreakdownDaily } from '../sync/meta-ads-breakdown.contract';

/**
 * Rows written per statement.
 *
 * A breakdown fact binds about twenty parameters, so 200 rows is roughly 4 000
 * of the 65 535 Postgres allows — the same headroom the facts writer keeps, and
 * it matters more here: a dimension multiplies a window's row count by its own
 * size, so this writer sees several times the volume for the same period.
 */
const CHUNK_SIZE = 200;

/**
 * Columns an upsert refreshes when the fact already exists.
 *
 * Meta restates recent days for up to 28 days, so re-reading a window must
 * change the numbers in place. Every measured column is here, and so is
 * `synced_at`, the only record of when the restatement was collected.
 *
 * Absent on purpose:
 *
 * - `created_at`, which answers "when did Lyra first record this bucket". A
 *   write that overwrote it would reset that answer on every re-read.
 * - the eight identity columns, which are the conflict target: they are what
 *   matched, so writing them would be writing them to themselves.
 */
export const REFRESHED_BREAKDOWN_COLUMNS = [
  'agency_client_id',
  'provider',
  'account_timezone',
  'currency',
  'spend',
  'impressions',
  'clicks',
  'link_clicks',
  'reach',
  'actions',
  'is_partial',
  'synced_at',
  'updated_at',
];

/**
 * The unique identity of a breakdown fact, and the ON CONFLICT target.
 *
 * Mirrors `UQ_social_ad_breakdown_daily_fact` exactly. `breakdown_kind` sits
 * beside `breakdown_key` because Meta's dimension vocabularies overlap: keyed on
 * the value alone, a device platform named `mobile_app` and a publisher platform
 * that came to share the name would overwrite each other.
 */
export const BREAKDOWN_IDENTITY_COLUMNS = [
  'tenant_id',
  'workspace_id',
  'connection_id',
  'entity_level',
  'entity_external_id',
  'metric_date',
  'breakdown_kind',
  'breakdown_key',
];

/**
 * Writes breakdown facts.
 *
 * The only component that touches `social_ad_breakdown_daily`, and it does one
 * thing to it: upsert normalized rows on their identity. No delete and no
 * archive, for the reason the facts writer documents — Meta returns no row at
 * all for a bucket with no delivery, so absence in a window means "nothing
 * happened", and overwriting a stored bucket with that would erase real spend.
 *
 * Kept separate from `SocialAdMetricsWriterService` rather than added as a
 * method there. That class owns one table and one conflict target; a class that
 * owned two would be one where a future edit can apply the wrong identity
 * column list to the wrong table, and both lists look plausible against either.
 */
@Injectable()
export class SocialAdBreakdownWriterService {
  constructor(
    @InjectRepository(SocialAdBreakdownDailyEntity, 'agency')
    private readonly breakdownRepository: Repository<SocialAdBreakdownDailyEntity>,
  ) {}

  /** Upserts normalized breakdown facts, each already carrying its own scope. */
  async upsert(rows: readonly NormalizedAdBreakdownDaily[]): Promise<number> {
    if (!rows.length) return 0;

    let written = 0;

    for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
      const chunk = rows.slice(index, index + CHUNK_SIZE);

      await this.breakdownRepository
        .createQueryBuilder()
        .insert()
        .into(SocialAdBreakdownDailyEntity)
        .values(
          chunk.map((row) => ({
            tenantId: row.tenantId,
            workspaceId: row.workspaceId,
            agencyClientId: row.agencyClientId,
            connectionId: row.connectionId,
            provider: row.provider,
            entityLevel: row.entityLevel,
            entityExternalId: row.entityExternalId,
            metricDate: row.metricDate,
            accountTimezone: row.accountTimezone,
            currency: row.currency,
            breakdownKind: row.breakdownKind,
            breakdownKey: row.breakdownKey,
            spend: row.spend,
            impressions: row.impressions,
            clicks: row.clicks,
            linkClicks: row.linkClicks,
            reach: row.reach,
            actions: row.actions,
            isPartial: row.isPartial,
            syncedAt: row.syncedAt,
          })) as QueryDeepPartialEntity<SocialAdBreakdownDailyEntity>[],
        )
        .orUpdate(REFRESHED_BREAKDOWN_COLUMNS, BREAKDOWN_IDENTITY_COLUMNS)
        // Without this TypeORM reconciles the returned rows back onto the value
        // objects, which on a bulk upsert costs more than the write itself.
        .updateEntity(false)
        .execute();

      written += chunk.length;
    }

    return written;
  }
}
