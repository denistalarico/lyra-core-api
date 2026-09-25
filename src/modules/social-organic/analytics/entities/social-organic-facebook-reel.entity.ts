import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One Facebook Page reel, with the counters its own edge reports.
 *
 * ## Why a Facebook reel is not a row on the post fact
 *
 * It is not discoverable or measurable through anything the post table's
 * collector uses. A Page reel does not appear on `/{page}/posts`, and
 * `/{reel}/insights` answers nothing — the metrics live on
 * `/{reel}/video_insights`, under names (`fb_reels_total_plays`,
 * `blue_reels_play_count`, `post_video_retention_graph`) that no other surface
 * accepts. Verified against production on 2026-09-24.
 *
 * The vocabulary does not line up either. An Instagram reel reports views,
 * reach and saves; a Facebook reel reports plays, replays and unique viewers.
 * Those are different measurements, not different spellings — a play counts a
 * start, a view counts a threshold — so putting them in one column would make
 * the two surfaces look comparable when they are not.
 *
 * ## This one *is* a cache, unlike the stories table
 *
 * A reel is permanent: `/{page}/video_reels` still lists one published in
 * February, so a pass that misses a reel catches it on the next run and the
 * table converges. The grain is therefore one row per reel — not one per day —
 * with counters overwritten by the most recent read, because for a lifetime
 * total the latest reading is simply the best one.
 *
 * `observed_at` says when that reading was taken, which is what tells a reader
 * whether a zero means "nobody watched" or "not measured since publication".
 */
@Entity('social_organic_facebook_reels')
@Index(
  'UQ_social_organic_facebook_reels_fact',
  ['assetId', 'externalPublicationId'],
  { unique: true },
)
@Index('IDX_social_organic_facebook_reels_published', [
  'assetId',
  'publishedAt',
])
@Index('IDX_social_organic_facebook_reels_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'publishedAt',
])
@Check(
  'CK_social_organic_facebook_reels_non_negative',
  `("plays" IS NULL OR "plays" >= 0)
   AND ("blue_reels_plays" IS NULL OR "blue_reels_plays" >= 0)
   AND ("replays" IS NULL OR "replays" >= 0)
   AND ("unique_viewers" IS NULL OR "unique_viewers" >= 0)
   AND ("total_watch_time_ms" IS NULL OR "total_watch_time_ms" >= 0)
   AND ("avg_watch_time_ms" IS NULL OR "avg_watch_time_ms" >= 0)
   AND ("reactions_total" IS NULL OR "reactions_total" >= 0)
   AND ("comments" IS NULL OR "comments" >= 0)
   AND ("shares" IS NULL OR "shares" >= 0)
   AND ("new_followers" IS NULL OR "new_followers" >= 0)`,
)
export class SocialOrganicFacebookReelEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** NULL means the agency's own context; otherwise this is a managed client. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  @Column({ name: 'external_publication_id', type: 'varchar', length: 180 })
  externalPublicationId!: string;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  /** The reel's caption, as Meta calls it on this edge. */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /**
   * Meta returns this as a path (`/reel/885635650762805/`), not a URL. It is
   * stored exactly as given and absolutized at read time, so the column keeps
   * whatever Meta said rather than a value this code invented.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  permalink!: string | null;

  /**
   * A signed CDN URL that expires in about five days.
   *
   * Stored anyway, unlike on the post fact where thumbnails are re-resolved on
   * demand: re-resolving costs one call per reel per view, and a reel table is
   * a ranking of many. A dead link renders as the missing-image placeholder,
   * which is the same outcome as having no column at all.
   */
  @Column({
    name: 'thumbnail_url',
    type: 'varchar',
    length: 1000,
    nullable: true,
  })
  thumbnailUrl!: string | null;

  /** Duration in seconds, fractional as Meta reports it (27.271). */
  @Column({
    name: 'length_seconds',
    type: 'numeric',
    precision: 10,
    scale: 3,
    nullable: true,
  })
  lengthSeconds!: string | null;

  /**
   * `fb_reels_total_plays` — every start, including replays by the same person.
   *
   * The headline number Meta shows as "reproduções". Not the same as
   * `uniqueViewers` and not a subset of it: one person replaying three times is
   * three plays and one viewer.
   */
  @Column({ type: 'bigint', nullable: true })
  plays!: string | null;

  /**
   * `blue_reels_play_count` — plays that passed Meta's own counting threshold.
   *
   * Consistently lower than `plays` (production: 5 285 against 5 659). Meta
   * does not document the difference precisely, so both are stored rather than
   * one being chosen: picking the larger would flatter, and picking the smaller
   * would understate against what the Page owner sees in their own dashboard.
   */
  @Column({ name: 'blue_reels_plays', type: 'bigint', nullable: true })
  blueReelsPlays!: string | null;

  /** `fb_reels_replay_count` — plays that were a repeat by the same viewer. */
  @Column({ type: 'bigint', nullable: true })
  replays!: string | null;

  /**
   * `post_impressions_unique` — accounts that saw this reel at least once.
   *
   * The only unique-viewer figure Meta still reports anywhere on the Facebook
   * side. Every Page-level equivalent has been retired, which is why the Page
   * block has no "Visualizadores" card and the reels block does.
   *
   * A stock, not a flow: never summed across reels. Two reels with 100 viewers
   * each were not seen by 200 people, and Meta does not offer the de-duplicated
   * union.
   */
  @Column({ name: 'unique_viewers', type: 'bigint', nullable: true })
  uniqueViewers!: string | null;

  /** `post_video_view_time` — total milliseconds watched, across all viewers. */
  @Column({ name: 'total_watch_time_ms', type: 'bigint', nullable: true })
  totalWatchTimeMs!: string | null;

  /**
   * `post_video_avg_time_watched` — mean milliseconds per view.
   *
   * Already a mean, so it is not averageable across reels without weighting by
   * plays. A reader that wants the account's average watch time divides summed
   * `total_watch_time_ms` by summed `plays` instead.
   */
  @Column({ name: 'avg_watch_time_ms', type: 'bigint', nullable: true })
  avgWatchTimeMs!: string | null;

  /** Reactions as Meta totals them; see the per-emoji columns below. */
  @Column({ name: 'reactions_total', type: 'bigint', nullable: true })
  reactionsTotal!: string | null;

  @Column({ name: 'reactions_like', type: 'bigint', nullable: true })
  reactionsLike!: string | null;

  @Column({ name: 'reactions_love', type: 'bigint', nullable: true })
  reactionsLove!: string | null;

  @Column({ name: 'reactions_wow', type: 'bigint', nullable: true })
  reactionsWow!: string | null;

  @Column({ name: 'reactions_haha', type: 'bigint', nullable: true })
  reactionsHaha!: string | null;

  /** Meta's own name for the "sad" reaction on this edge. */
  @Column({ name: 'reactions_sorry', type: 'bigint', nullable: true })
  reactionsSorry!: string | null;

  @Column({ name: 'reactions_anger', type: 'bigint', nullable: true })
  reactionsAnger!: string | null;

  @Column({ type: 'bigint', nullable: true })
  comments!: string | null;

  @Column({ type: 'bigint', nullable: true })
  shares!: string | null;

  /** `post_video_followers` — accounts that followed the Page from this reel. */
  @Column({ name: 'new_followers', type: 'bigint', nullable: true })
  newFollowers!: string | null;

  /**
   * `post_video_retention_graph` — the share still watching at each second.
   *
   * Meta's own shape, stored unmodified: `{"0": 0.9822, "1": 0.9841, ...}`,
   * one key per second of the reel, each a fraction between 0 and 1.
   *
   * jsonb rather than a normalised table because the curve is only ever read
   * whole — no query filters or sorts by the value at second 7. A row per
   * second per reel would be thousands of rows to answer "draw this line".
   */
  @Column({ name: 'retention_graph', type: 'jsonb', nullable: true })
  retentionGraph!: Record<string, number> | null;

  /** When these counters were last read. A reel is re-read, so this moves. */
  @Column({ name: 'observed_at', type: 'timestamptz', default: () => 'now()' })
  observedAt!: Date;

  /** Pruning a run log must not delete the facts it produced. */
  @Column({ name: 'sync_run_id', type: 'uuid', nullable: true })
  syncRunId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
