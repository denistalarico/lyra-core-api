import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Facebook Page block: post engagement, reactions by emoji, and reels.
 *
 * ## What Meta still answers for a Page, verified on 2026-09-24
 *
 * Most of what a Page reported historically is gone. Every `*_unique` metric
 * this block would have wanted answers `(#100) The value must be a valid
 * insights metric`: `page_impressions_unique`, `page_views_unique`,
 * `post_impressions_unique`, `page_content_viewers` and a dozen other
 * spellings. That is not a permissions problem and not a version to pin back
 * to — it is a retirement, and it is why this migration has no "viewers"
 * column at the Page or post level. The one surface that still reports unique
 * viewers is a reel, through a different edge; see below.
 *
 * What does answer, and what these columns hold:
 *
 * - `page_media_view` (already collected) — total views of Page content.
 * - `post_reactions_by_type_total` — a **map** of reaction name to count,
 *   `{"like": 1, "love": 3}`. This is the emoji table the operator asked for,
 *   and Meta gives it per post rather than per Page.
 * - `shares` / `comments.summary` — fields on the post, not insights.
 * - `/{page}/video_reels` + `/{reel}/video_insights` — a separate edge with
 *   its own metric names, none of which the post edge accepts.
 *
 * ## 1. Reaction counts on the post fact
 *
 * Six columns rather than one jsonb map, because the operator's table has a
 * column per emoji and a reader that has to unpack jsonb to sort by "love"
 * cannot push the sort into SQL. Meta's six reaction types are a closed set
 * that has not changed since 2016; a seventh would be a migration, which is
 * the right amount of friction for a change that would also need a column in
 * the UI.
 *
 * `reactions_total` is stored alongside them rather than derived, because Meta
 * reports the total separately (`reactions.summary.total_count`) and the two
 * can legitimately disagree: the summary counts reactions as of now, while the
 * insights map is a lifetime total that includes reactions since removed.
 * Deriving one from the other would paper over a real difference.
 *
 * ## 2. Facebook reels get their own table
 *
 * A Page reel is not on `/{page}/posts` and its metrics are not on
 * `/{post}/insights`. It lives on `/{page}/video_reels` and answers
 * `/{reel}/video_insights`, whose metric names (`fb_reels_total_plays`,
 * `blue_reels_play_count`, `post_impressions_unique`) exist nowhere else.
 *
 * It is a separate table rather than rows on `social_organic_post_metrics_daily`
 * for a reason that is not cosmetic: that table's unique key is
 * `(asset_id, external_publication_id, metric_date, source)` and its columns
 * are the Instagram media vocabulary. A Facebook reel shares almost none of it
 * — it has plays, replays and unique viewers where an IG reel has views, reach
 * and saves — so it would be a row of nulls beside four populated columns, and
 * every reader of the post table would have to learn to exclude it.
 *
 * Unlike `social_organic_stories`, this table **is** a cache: a reel is
 * permanent, `/{page}/video_reels` still lists one from February, and a missed
 * pass is caught by the next one. The grain is therefore one row per reel, with
 * counters overwritten by the most recent read.
 *
 * ## 3. The retention curve is stored as jsonb, and that is deliberate
 *
 * `post_video_retention_graph` is ~27 points per reel — the share of viewers
 * still watching at each second, `{"0": 0.9822, "1": 0.9841, ...}`. It is the
 * one thing here that is a *curve* rather than a counter, and normalising it
 * would mean a second table with a row per second per reel: thousands of rows
 * to answer one question, which is "draw this line".
 *
 * jsonb is right because the curve is only ever read whole. No query filters or
 * sorts by the value at second 7; the chart asks for the reel and draws what it
 * gets. The shape is Meta's own and is stored unmodified, so a change on their
 * side surfaces as a chart that looks wrong rather than as an ingest that
 * silently drops points it did not recognise.
 */
export class AddFacebookPageMeasures1796400000000 implements MigrationInterface {
  name = 'AddFacebookPageMeasures1796400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- 1. Reactions and engagement on the post fact -------------------
    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        ADD COLUMN IF NOT EXISTS "reactions_total" bigint,
        ADD COLUMN IF NOT EXISTS "reactions_like" bigint,
        ADD COLUMN IF NOT EXISTS "reactions_love" bigint,
        ADD COLUMN IF NOT EXISTS "reactions_wow" bigint,
        ADD COLUMN IF NOT EXISTS "reactions_haha" bigint,
        ADD COLUMN IF NOT EXISTS "reactions_sorry" bigint,
        ADD COLUMN IF NOT EXISTS "reactions_anger" bigint,
        ADD COLUMN IF NOT EXISTS "views_organic_lifetime" bigint,
        ADD COLUMN IF NOT EXISTS "views_paid_lifetime" bigint
    `);

    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        DROP CONSTRAINT IF EXISTS "CK_social_organic_post_metrics_daily_reactions"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        ADD CONSTRAINT "CK_social_organic_post_metrics_daily_reactions"
        CHECK (
          ("reactions_total" IS NULL OR "reactions_total" >= 0)
          AND ("reactions_like" IS NULL OR "reactions_like" >= 0)
          AND ("reactions_love" IS NULL OR "reactions_love" >= 0)
          AND ("reactions_wow" IS NULL OR "reactions_wow" >= 0)
          AND ("reactions_haha" IS NULL OR "reactions_haha" >= 0)
          AND ("reactions_sorry" IS NULL OR "reactions_sorry" >= 0)
          AND ("reactions_anger" IS NULL OR "reactions_anger" >= 0)
          AND ("views_organic_lifetime" IS NULL OR "views_organic_lifetime" >= 0)
          AND ("views_paid_lifetime" IS NULL OR "views_paid_lifetime" >= 0)
        )
    `);

    // ---- 2. Page-level period counters ----------------------------------
    // Reused by the same period cache the Instagram block measures into. A
    // Page has no de-duplicated reach to store, for the reason the docblock
    // gives, so these are the counters it *can* answer.
    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        ADD COLUMN IF NOT EXISTS "page_views" bigint,
        ADD COLUMN IF NOT EXISTS "page_reactions_total" bigint,
        ADD COLUMN IF NOT EXISTS "page_comments" bigint,
        ADD COLUMN IF NOT EXISTS "page_shares" bigint,
        ADD COLUMN IF NOT EXISTS "page_post_count" int,
        ADD COLUMN IF NOT EXISTS "page_reel_count" int
    `);

    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        DROP CONSTRAINT IF EXISTS "CK_social_organic_reach_periods_page"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        ADD CONSTRAINT "CK_social_organic_reach_periods_page"
        CHECK (
          ("page_views" IS NULL OR "page_views" >= 0)
          AND ("page_reactions_total" IS NULL OR "page_reactions_total" >= 0)
          AND ("page_comments" IS NULL OR "page_comments" >= 0)
          AND ("page_shares" IS NULL OR "page_shares" >= 0)
          AND ("page_post_count" IS NULL OR "page_post_count" >= 0)
          AND ("page_reel_count" IS NULL OR "page_reel_count" >= 0)
        )
    `);

    // ---- 3. Facebook reels ----------------------------------------------
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_organic_facebook_reels" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "asset_id" uuid NOT NULL,
        "provider" character varying(40) NOT NULL,
        "external_publication_id" character varying(180) NOT NULL,
        "published_at" timestamptz,
        "description" text,
        "permalink" character varying(500),
        "thumbnail_url" character varying(1000),
        "length_seconds" numeric(10,3),
        "plays" bigint,
        "blue_reels_plays" bigint,
        "replays" bigint,
        "unique_viewers" bigint,
        "total_watch_time_ms" bigint,
        "avg_watch_time_ms" bigint,
        "reactions_total" bigint,
        "reactions_like" bigint,
        "reactions_love" bigint,
        "reactions_wow" bigint,
        "reactions_haha" bigint,
        "reactions_sorry" bigint,
        "reactions_anger" bigint,
        "comments" bigint,
        "shares" bigint,
        "new_followers" bigint,
        "retention_graph" jsonb,
        "observed_at" timestamptz NOT NULL DEFAULT now(),
        "sync_run_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_organic_facebook_reels" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_social_organic_facebook_reels_fact"
          UNIQUE ("asset_id", "external_publication_id"),
        CONSTRAINT "CK_social_organic_facebook_reels_non_negative" CHECK (
          ("plays" IS NULL OR "plays" >= 0)
          AND ("blue_reels_plays" IS NULL OR "blue_reels_plays" >= 0)
          AND ("replays" IS NULL OR "replays" >= 0)
          AND ("unique_viewers" IS NULL OR "unique_viewers" >= 0)
          AND ("total_watch_time_ms" IS NULL OR "total_watch_time_ms" >= 0)
          AND ("avg_watch_time_ms" IS NULL OR "avg_watch_time_ms" >= 0)
          AND ("reactions_total" IS NULL OR "reactions_total" >= 0)
          AND ("comments" IS NULL OR "comments" >= 0)
          AND ("shares" IS NULL OR "shares" >= 0)
          AND ("new_followers" IS NULL OR "new_followers" >= 0)
        ),
        CONSTRAINT "FK_social_organic_facebook_reels_asset"
          FOREIGN KEY ("asset_id")
          REFERENCES "social_organic_assets"("id") ON DELETE CASCADE
      )
    `);

    // The ranking query: one asset, a publish-date window, ordered by a
    // counter. Both columns are in the index so the window is a range scan
    // rather than a filter over every reel the Page has ever posted.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_facebook_reels_published"
        ON "social_organic_facebook_reels" ("asset_id", "published_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_facebook_reels_scope"
        ON "social_organic_facebook_reels"
        ("tenant_id", "workspace_id", "agency_client_id", "published_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_social_organic_facebook_reels_scope"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_social_organic_facebook_reels_published"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_organic_facebook_reels"`,
    );

    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        DROP CONSTRAINT IF EXISTS "CK_social_organic_reach_periods_page"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        DROP COLUMN IF EXISTS "page_views",
        DROP COLUMN IF EXISTS "page_reactions_total",
        DROP COLUMN IF EXISTS "page_comments",
        DROP COLUMN IF EXISTS "page_shares",
        DROP COLUMN IF EXISTS "page_post_count",
        DROP COLUMN IF EXISTS "page_reel_count"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        DROP CONSTRAINT IF EXISTS "CK_social_organic_post_metrics_daily_reactions"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        DROP COLUMN IF EXISTS "reactions_total",
        DROP COLUMN IF EXISTS "reactions_like",
        DROP COLUMN IF EXISTS "reactions_love",
        DROP COLUMN IF EXISTS "reactions_wow",
        DROP COLUMN IF EXISTS "reactions_haha",
        DROP COLUMN IF EXISTS "reactions_sorry",
        DROP COLUMN IF EXISTS "reactions_anger",
        DROP COLUMN IF EXISTS "views_organic_lifetime",
        DROP COLUMN IF EXISTS "views_paid_lifetime"
    `);
  }
}
