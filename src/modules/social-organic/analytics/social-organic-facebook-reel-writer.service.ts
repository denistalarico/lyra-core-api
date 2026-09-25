import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

/**
 * One reading of one Facebook reel.
 *
 * Every counter is nullable and every null means "not measured", never zero.
 * A reel whose `video_insights` call is refused still has an identity worth
 * storing, and the writer's COALESCE keeps whatever an earlier, fuller read
 * put there.
 */
export type OrganicFacebookReelObservation = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  assetId: string;
  provider: string;
  externalPublicationId: string;
  publishedAt: Date | null;
  description: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  lengthSeconds: string | null;
  plays: string | null;
  blueReelsPlays: string | null;
  replays: string | null;
  uniqueViewers: string | null;
  totalWatchTimeMs: string | null;
  avgWatchTimeMs: string | null;
  reactionsTotal: string | null;
  reactionsLike: string | null;
  reactionsLove: string | null;
  reactionsWow: string | null;
  reactionsHaha: string | null;
  reactionsSorry: string | null;
  reactionsAnger: string | null;
  comments: string | null;
  shares: string | null;
  newFollowers: string | null;
  retentionGraph: Record<string, number> | null;
  observedAt: Date;
  syncRunId: string | null;
};

/**
 * Writes Facebook reel observations, one row per reel.
 *
 * Unlike the stories writer, this one has no `first_observed_at` to protect: a
 * reel is permanent and can be re-read forever, so there is nothing about the
 * first sighting that a later one cannot recover.
 *
 * What it does share is the COALESCE rule on every counter. A pass in which
 * Meta refused `video_insights` must not blank the numbers a successful pass
 * stored — "no new evidence" is not "the value is now unknown".
 *
 * `retention_graph` is the exception and overwrites unconditionally when
 * present: it is a whole curve, and merging an old curve with a new one would
 * produce a line that describes no actual reel. A null still keeps the stored
 * curve, so a refused read loses nothing.
 */
@Injectable()
export class SocialOrganicFacebookReelWriterService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async upsert(rows: OrganicFacebookReelObservation[]): Promise<number> {
    if (rows.length === 0) return 0;

    await this.dataSource.transaction(async (manager) => {
      for (const row of rows) {
        await manager.query(
          `INSERT INTO social_organic_facebook_reels (
             tenant_id, workspace_id, agency_client_id, asset_id, provider,
             external_publication_id, published_at, description, permalink,
             thumbnail_url, length_seconds, plays, blue_reels_plays, replays,
             unique_viewers, total_watch_time_ms, avg_watch_time_ms,
             reactions_total, reactions_like, reactions_love, reactions_wow,
             reactions_haha, reactions_sorry, reactions_anger,
             comments, shares, new_followers, retention_graph,
             observed_at, sync_run_id
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
             $28::jsonb, $29, $30
           )
           ON CONFLICT (asset_id, external_publication_id) DO UPDATE SET
             published_at = COALESCE(EXCLUDED.published_at, social_organic_facebook_reels.published_at),
             description = COALESCE(EXCLUDED.description, social_organic_facebook_reels.description),
             permalink = COALESCE(EXCLUDED.permalink, social_organic_facebook_reels.permalink),
             -- The one identity field that SHOULD move: a signed CDN URL
             -- expires in days, so the newest one is the only one with a
             -- chance of resolving. COALESCE still guards a refused read.
             thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, social_organic_facebook_reels.thumbnail_url),
             length_seconds = COALESCE(EXCLUDED.length_seconds, social_organic_facebook_reels.length_seconds),
             plays = COALESCE(EXCLUDED.plays, social_organic_facebook_reels.plays),
             blue_reels_plays = COALESCE(EXCLUDED.blue_reels_plays, social_organic_facebook_reels.blue_reels_plays),
             replays = COALESCE(EXCLUDED.replays, social_organic_facebook_reels.replays),
             unique_viewers = COALESCE(EXCLUDED.unique_viewers, social_organic_facebook_reels.unique_viewers),
             total_watch_time_ms = COALESCE(EXCLUDED.total_watch_time_ms, social_organic_facebook_reels.total_watch_time_ms),
             avg_watch_time_ms = COALESCE(EXCLUDED.avg_watch_time_ms, social_organic_facebook_reels.avg_watch_time_ms),
             reactions_total = COALESCE(EXCLUDED.reactions_total, social_organic_facebook_reels.reactions_total),
             reactions_like = COALESCE(EXCLUDED.reactions_like, social_organic_facebook_reels.reactions_like),
             reactions_love = COALESCE(EXCLUDED.reactions_love, social_organic_facebook_reels.reactions_love),
             reactions_wow = COALESCE(EXCLUDED.reactions_wow, social_organic_facebook_reels.reactions_wow),
             reactions_haha = COALESCE(EXCLUDED.reactions_haha, social_organic_facebook_reels.reactions_haha),
             reactions_sorry = COALESCE(EXCLUDED.reactions_sorry, social_organic_facebook_reels.reactions_sorry),
             reactions_anger = COALESCE(EXCLUDED.reactions_anger, social_organic_facebook_reels.reactions_anger),
             comments = COALESCE(EXCLUDED.comments, social_organic_facebook_reels.comments),
             shares = COALESCE(EXCLUDED.shares, social_organic_facebook_reels.shares),
             new_followers = COALESCE(EXCLUDED.new_followers, social_organic_facebook_reels.new_followers),
             -- Replaced whole, never merged: half of one curve and half of
             -- another describes no reel that exists.
             retention_graph = COALESCE(EXCLUDED.retention_graph, social_organic_facebook_reels.retention_graph),
             observed_at = EXCLUDED.observed_at,
             sync_run_id = COALESCE(EXCLUDED.sync_run_id, social_organic_facebook_reels.sync_run_id),
             updated_at = now()`,
          [
            row.tenantId,
            row.workspaceId,
            row.agencyClientId,
            row.assetId,
            row.provider,
            row.externalPublicationId,
            row.publishedAt,
            row.description,
            row.permalink,
            row.thumbnailUrl,
            row.lengthSeconds,
            row.plays,
            row.blueReelsPlays,
            row.replays,
            row.uniqueViewers,
            row.totalWatchTimeMs,
            row.avgWatchTimeMs,
            row.reactionsTotal,
            row.reactionsLike,
            row.reactionsLove,
            row.reactionsWow,
            row.reactionsHaha,
            row.reactionsSorry,
            row.reactionsAnger,
            row.comments,
            row.shares,
            row.newFollowers,
            row.retentionGraph === null
              ? null
              : JSON.stringify(row.retentionGraph),
            row.observedAt,
            row.syncRunId,
          ],
        );
      }
    });

    return rows.length;
  }
}
