import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { SocialAdMetricDailyEntity } from '../entities/social-ad-metric-daily.entity';
import type { NormalizedAdMetricDaily } from '../sync/meta-ads-insights.contract';

/**
 * Rows written per statement.
 *
 * A fact binds around twenty-four parameters, so 200 rows is roughly 4 800 of
 * the 65 535 Postgres allows — the same headroom the hierarchy writer keeps,
 * for the same reason: a 90-day campaign-level window is thousands of rows and
 * one statement per row would make the ingest network-bound.
 */
const CHUNK_SIZE = 200;

/**
 * Columns an upsert refreshes when the fact already exists.
 *
 * Meta restates recent days for up to 28 days — a conversion attributed today
 * belongs to the click three days ago — so re-reading a window *must* change
 * the numbers in place. Every measured column is therefore here, and so is
 * `synced_at`, which is the only record of when the restatement was collected.
 *
 * Absent on purpose:
 *
 * - `created_at`, which answers "when did Lyra first record this day". A write
 *   that overwrote it would reset that answer on every re-read, permanently.
 * - the eight identity columns, which are the conflict target: they are what
 *   matched, so writing them would be writing them to themselves.
 * - `sync_run_id` and `raw`, which this slice does not produce. Listing a
 *   column that is always NULL would quietly erase a value some later writer
 *   put there.
 */
export const REFRESHED_METRIC_COLUMNS = [
  'agency_client_id',
  'provider',
  'campaign_external_id',
  'account_timezone',
  'currency',
  'spend',
  'impressions',
  'reach',
  'clicks',
  'link_clicks',
  'leads',
  'conversions',
  'conversion_value',
  'video_views',
  'actions',
  'is_partial',
  'synced_at',
  'updated_at',
];

/**
 * The unique identity of a daily fact, and the ON CONFLICT target.
 *
 * Mirrors `UQ_social_ad_metrics_daily_fact` exactly. `source` and
 * `attribution_setting` are part of it because they are different ways of
 * measuring the same object on the same day, not corrections of each other:
 * dropping either would make a future 7-day-click pull silently overwrite the
 * numbers already reported to a client under the account's own setting.
 */
export const METRIC_IDENTITY_COLUMNS = [
  'tenant_id',
  'workspace_id',
  'connection_id',
  'source',
  'entity_level',
  'entity_external_id',
  'metric_date',
  'attribution_setting',
];

/**
 * Writes daily ad facts.
 *
 * The only component that touches `social_ad_metrics_daily`, and it does one
 * thing to it: upsert normalized rows on their identity. The one read it also
 * owns asks whether history exists, and it lives here rather than in the
 * planner that needs it so that the table keeps a single owner — a second
 * component holding this repository is how a second, differently-shaped write
 * eventually appears. There is no delete and no
 * archive here — unlike the hierarchy, a fact that stops being reported is not
 * evidence of anything, because Meta returns no row at all for a day with no
 * delivery. Absence in a window means "nothing happened", and overwriting a
 * stored day with that would erase real spend.
 */
@Injectable()
export class SocialAdMetricsWriterService {
  constructor(
    @InjectRepository(SocialAdMetricDailyEntity, 'agency')
    private readonly metricsRepository: Repository<SocialAdMetricDailyEntity>,
  ) {}

  /** Upserts normalized facts, each already carrying its own scope. */
  async upsert(rows: readonly NormalizedAdMetricDaily[]): Promise<number> {
    if (!rows.length) return 0;

    let written = 0;

    for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
      const chunk = rows.slice(index, index + CHUNK_SIZE);

      await this.metricsRepository
        .createQueryBuilder()
        .insert()
        .into(SocialAdMetricDailyEntity)
        .values(
          chunk.map((row) => ({
            tenantId: row.tenantId,
            workspaceId: row.workspaceId,
            agencyClientId: row.agencyClientId,
            connectionId: row.connectionId,
            provider: row.provider,
            source: row.source,
            entityLevel: row.entityLevel,
            entityExternalId: row.entityExternalId,
            campaignExternalId: row.campaignExternalId,
            metricDate: row.metricDate,
            accountTimezone: row.accountTimezone,
            currency: row.currency,
            attributionSetting: row.attributionSetting,
            spend: row.spend,
            impressions: row.impressions,
            reach: row.reach,
            clicks: row.clicks,
            linkClicks: row.linkClicks,
            leads: row.leads,
            conversions: row.conversions,
            conversionValue: row.conversionValue,
            videoViews: row.videoViews,
            actions: row.actions,
            isPartial: row.isPartial,
            syncedAt: row.syncedAt,
            // `raw` and `sync_run_id` are deliberately unwritten: this slice
            // produces neither, and a column written NULL is a column a later
            // writer's value would be erased from.
          })) as QueryDeepPartialEntity<SocialAdMetricDailyEntity>[],
        )
        .orUpdate(REFRESHED_METRIC_COLUMNS, METRIC_IDENTITY_COLUMNS)
        // Without this TypeORM reconciles the returned rows back onto the value
        // objects, which on a bulk upsert costs more than the write itself.
        .updateEntity(false)
        .execute();

      written += chunk.length;
    }

    return written;
  }
}
