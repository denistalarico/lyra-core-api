import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import type {
  NormalizedOrganicAccountMetricDaily,
  NormalizedOrganicPostMetricDaily,
} from './social-organic-insights.contract';

export type SocialOrganicMetricsWriteResult = {
  postRows: number;
  accountRows: number;
};

/** A2's only fact writer. The transaction makes one asset sync all-or-nothing. */
@Injectable()
export class SocialOrganicMetricsWriterService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async upsert(input: {
    postRows: readonly NormalizedOrganicPostMetricDaily[];
    accountRows: readonly NormalizedOrganicAccountMetricDaily[];
  }): Promise<SocialOrganicMetricsWriteResult> {
    if (input.postRows.length === 0 && input.accountRows.length === 0) {
      return { postRows: 0, accountRows: 0 };
    }

    return this.dataSource.transaction(async (manager) => {
      for (const row of input.accountRows)
        await this.upsertAccount(manager, row);
      for (const row of input.postRows) await this.upsertPost(manager, row);
      return {
        postRows: input.postRows.length,
        accountRows: input.accountRows.length,
      };
    });
  }

  private async upsertAccount(
    manager: EntityManager,
    row: NormalizedOrganicAccountMetricDaily,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO social_organic_account_metrics_daily (
         tenant_id, workspace_id, agency_client_id, asset_id, provider, source,
         metric_date, asset_timezone, followers_count, followers_gained,
         followers_lost, impressions, reach, profile_views, is_partial,
         synced_at, sync_run_id, provider_metrics
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18::jsonb
       )
       ON CONFLICT (asset_id, metric_date, source) DO UPDATE SET
         followers_count = COALESCE(EXCLUDED.followers_count, social_organic_account_metrics_daily.followers_count),
         followers_gained = COALESCE(EXCLUDED.followers_gained, social_organic_account_metrics_daily.followers_gained),
         followers_lost = COALESCE(EXCLUDED.followers_lost, social_organic_account_metrics_daily.followers_lost),
         impressions = COALESCE(EXCLUDED.impressions, social_organic_account_metrics_daily.impressions),
         reach = COALESCE(EXCLUDED.reach, social_organic_account_metrics_daily.reach),
         profile_views = COALESCE(EXCLUDED.profile_views, social_organic_account_metrics_daily.profile_views),
         is_partial = EXCLUDED.is_partial,
         synced_at = EXCLUDED.synced_at,
         sync_run_id = EXCLUDED.sync_run_id,
         provider_metrics = social_organic_account_metrics_daily.provider_metrics || EXCLUDED.provider_metrics,
         updated_at = now()`,
      [
        row.tenantId,
        row.workspaceId,
        row.agencyClientId,
        row.assetId,
        row.provider,
        row.source,
        row.metricDate,
        row.assetTimezone,
        row.followersCount,
        row.followersGained,
        row.followersLost,
        row.impressions,
        row.reach,
        row.profileViews,
        row.isPartial,
        row.syncedAt,
        row.syncRunId,
        JSON.stringify(row.providerMetrics),
      ],
    );
  }

  private async upsertPost(
    manager: EntityManager,
    row: NormalizedOrganicPostMetricDaily,
  ): Promise<void> {
    // COALESCE on the 4 new `*_lifetime` columns (and their paired
    // `*_observed_at` instants) does not break monotonicity. Within one
    // `metricDate` row, COALESCE only prevents a same-day retry from
    // regressing a real value to NULL — consistent with "NULL means no new
    // evidence" for every other counter in this method. Across days,
    // monotonicity of a lifetime total is preserved for free: each
    // observation day gets its own row (`metricDate` is always the sync's
    // `currentDay`), and a reader always takes the latest row in the
    // requested period rather than treating any single row as an
    // unconditional overwrite target.
    await manager.query(
      `INSERT INTO social_organic_post_metrics_daily (
         tenant_id, workspace_id, agency_client_id, asset_id, provider, source,
         external_publication_id, publication_id, metric_date, asset_timezone,
         impressions, reach, likes, comments, shares, saves, video_views,
         watch_time_seconds, link_clicks, profile_visits,
         impressions_lifetime, impressions_lifetime_observed_at,
         likes_lifetime, likes_lifetime_observed_at,
         comments_lifetime, comments_lifetime_observed_at,
         video_views_lifetime, video_views_lifetime_observed_at,
         reach_lifetime, saves_lifetime, shares_lifetime,
         total_interactions_lifetime, profile_visits_lifetime, follows_lifetime,
         lifetime_observed_at,
         permalink, caption, media_type, media_product_type, published_at,
         is_partial, synced_at, sync_run_id, provider_metrics
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
         $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,
         $41, $42, $43, $44::jsonb
       )
       ON CONFLICT (asset_id, external_publication_id, metric_date, source)
       DO UPDATE SET
         publication_id = COALESCE(EXCLUDED.publication_id, social_organic_post_metrics_daily.publication_id),
         impressions = COALESCE(EXCLUDED.impressions, social_organic_post_metrics_daily.impressions),
         reach = COALESCE(EXCLUDED.reach, social_organic_post_metrics_daily.reach),
         likes = COALESCE(EXCLUDED.likes, social_organic_post_metrics_daily.likes),
         comments = COALESCE(EXCLUDED.comments, social_organic_post_metrics_daily.comments),
         shares = COALESCE(EXCLUDED.shares, social_organic_post_metrics_daily.shares),
         saves = COALESCE(EXCLUDED.saves, social_organic_post_metrics_daily.saves),
         video_views = COALESCE(EXCLUDED.video_views, social_organic_post_metrics_daily.video_views),
         watch_time_seconds = COALESCE(EXCLUDED.watch_time_seconds, social_organic_post_metrics_daily.watch_time_seconds),
         link_clicks = COALESCE(EXCLUDED.link_clicks, social_organic_post_metrics_daily.link_clicks),
         profile_visits = COALESCE(EXCLUDED.profile_visits, social_organic_post_metrics_daily.profile_visits),
         impressions_lifetime = COALESCE(EXCLUDED.impressions_lifetime, social_organic_post_metrics_daily.impressions_lifetime),
         impressions_lifetime_observed_at = COALESCE(EXCLUDED.impressions_lifetime_observed_at, social_organic_post_metrics_daily.impressions_lifetime_observed_at),
         likes_lifetime = COALESCE(EXCLUDED.likes_lifetime, social_organic_post_metrics_daily.likes_lifetime),
         likes_lifetime_observed_at = COALESCE(EXCLUDED.likes_lifetime_observed_at, social_organic_post_metrics_daily.likes_lifetime_observed_at),
         comments_lifetime = COALESCE(EXCLUDED.comments_lifetime, social_organic_post_metrics_daily.comments_lifetime),
         comments_lifetime_observed_at = COALESCE(EXCLUDED.comments_lifetime_observed_at, social_organic_post_metrics_daily.comments_lifetime_observed_at),
         video_views_lifetime = COALESCE(EXCLUDED.video_views_lifetime, social_organic_post_metrics_daily.video_views_lifetime),
         video_views_lifetime_observed_at = COALESCE(EXCLUDED.video_views_lifetime_observed_at, social_organic_post_metrics_daily.video_views_lifetime_observed_at),
         reach_lifetime = COALESCE(EXCLUDED.reach_lifetime, social_organic_post_metrics_daily.reach_lifetime),
         saves_lifetime = COALESCE(EXCLUDED.saves_lifetime, social_organic_post_metrics_daily.saves_lifetime),
         shares_lifetime = COALESCE(EXCLUDED.shares_lifetime, social_organic_post_metrics_daily.shares_lifetime),
         total_interactions_lifetime = COALESCE(EXCLUDED.total_interactions_lifetime, social_organic_post_metrics_daily.total_interactions_lifetime),
         profile_visits_lifetime = COALESCE(EXCLUDED.profile_visits_lifetime, social_organic_post_metrics_daily.profile_visits_lifetime),
         follows_lifetime = COALESCE(EXCLUDED.follows_lifetime, social_organic_post_metrics_daily.follows_lifetime),
         lifetime_observed_at = COALESCE(EXCLUDED.lifetime_observed_at, social_organic_post_metrics_daily.lifetime_observed_at),
         -- Identity fields follow the same COALESCE rule as the metrics: a read
         -- that did not resolve them must not erase what an earlier, fuller read
         -- stored. The cost is that a caption edited on the provider keeps its
         -- first-seen text; that is the trade this table already makes
         -- everywhere else, and losing the caption entirely is worse.
         permalink = COALESCE(EXCLUDED.permalink, social_organic_post_metrics_daily.permalink),
         caption = COALESCE(EXCLUDED.caption, social_organic_post_metrics_daily.caption),
         media_type = COALESCE(EXCLUDED.media_type, social_organic_post_metrics_daily.media_type),
         media_product_type = COALESCE(EXCLUDED.media_product_type, social_organic_post_metrics_daily.media_product_type),
         published_at = COALESCE(EXCLUDED.published_at, social_organic_post_metrics_daily.published_at),
         is_partial = EXCLUDED.is_partial,
         synced_at = EXCLUDED.synced_at,
         sync_run_id = EXCLUDED.sync_run_id,
         provider_metrics = social_organic_post_metrics_daily.provider_metrics || EXCLUDED.provider_metrics,
         updated_at = now()`,
      [
        row.tenantId,
        row.workspaceId,
        row.agencyClientId,
        row.assetId,
        row.provider,
        row.source,
        row.externalPublicationId,
        row.publicationId,
        row.metricDate,
        row.assetTimezone,
        row.impressions,
        row.reach,
        row.likes,
        row.comments,
        row.shares,
        row.saves,
        row.videoViews,
        row.watchTimeSeconds,
        row.linkClicks,
        row.profileVisits,
        row.impressionsLifetime,
        row.impressionsLifetimeObservedAt,
        row.likesLifetime,
        row.likesLifetimeObservedAt,
        row.commentsLifetime,
        row.commentsLifetimeObservedAt,
        row.videoViewsLifetime,
        row.videoViewsLifetimeObservedAt,
        row.reachLifetime,
        row.savesLifetime,
        row.sharesLifetime,
        row.totalInteractionsLifetime,
        row.profileVisitsLifetime,
        row.followsLifetime,
        row.lifetimeObservedAt,
        row.permalink,
        row.caption,
        row.mediaType,
        row.mediaProductType,
        row.publishedAt,
        row.isPartial,
        row.syncedAt,
        row.syncRunId,
        JSON.stringify(row.providerMetrics),
      ],
    );
  }
}
