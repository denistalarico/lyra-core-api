import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { SocialAdSearchTermDailyEntity } from '../entities/social-ad-search-term-daily.entity';
import type { NormalizedAdSearchTermDaily } from '../sync/google-ads-detail.normalizer';

/** About 20 parameters a row: 200 rows stays far below Postgres' 65 535. */
const CHUNK_SIZE = 200;

/** Mirrors `UQ_social_ad_search_terms_daily_fact`: the ON CONFLICT target. */
export const SEARCH_TERM_IDENTITY_COLUMNS = [
  'tenant_id',
  'workspace_id',
  'connection_id',
  'campaign_external_id',
  'metric_date',
  'term_kind',
  'term_hash',
];

/** Google restates recent days, so a re-read refreshes every measure. */
export const REFRESHED_SEARCH_TERM_COLUMNS = [
  'agency_client_id',
  'provider',
  'account_timezone',
  'currency',
  'term_text',
  'impressions',
  'clicks',
  'spend',
  'conversions',
  'conversion_value',
  'is_partial',
  'synced_at',
  'updated_at',
];

/**
 * GA-DET (D-G4): the only writer of `social_ad_search_terms_daily`. Upsert
 * only, like the breakdown writer: a term absent from a re-read means "no
 * delivery that day", which must not erase a stored one.
 */
@Injectable()
export class SocialAdSearchTermWriterService {
  constructor(
    @InjectRepository(SocialAdSearchTermDailyEntity, 'agency')
    private readonly repository: Repository<SocialAdSearchTermDailyEntity>,
  ) {}

  async upsert(rows: readonly NormalizedAdSearchTermDaily[]): Promise<number> {
    if (!rows.length) return 0;

    let written = 0;
    for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
      const chunk = rows.slice(index, index + CHUNK_SIZE);
      await this.repository
        .createQueryBuilder()
        .insert()
        .into(SocialAdSearchTermDailyEntity)
        .values(
          chunk.map((row) => ({
            tenantId: row.tenantId,
            workspaceId: row.workspaceId,
            agencyClientId: row.agencyClientId,
            connectionId: row.connectionId,
            provider: row.provider,
            campaignExternalId: row.campaignExternalId,
            metricDate: row.metricDate,
            accountTimezone: row.accountTimezone,
            currency: row.currency,
            termKind: row.termKind,
            termText: row.termText,
            termHash: row.termHash,
            impressions: row.impressions,
            clicks: row.clicks,
            spend: row.spend,
            conversions: row.conversions,
            conversionValue: row.conversionValue,
            isPartial: row.isPartial,
            syncedAt: row.syncedAt,
          })) as QueryDeepPartialEntity<SocialAdSearchTermDailyEntity>[],
        )
        .orUpdate(REFRESHED_SEARCH_TERM_COLUMNS, SEARCH_TERM_IDENTITY_COLUMNS)
        .updateEntity(false)
        .execute();
      written += chunk.length;
    }

    return written;
  }
}
