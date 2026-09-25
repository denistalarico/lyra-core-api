import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The reel and story measures, across three tables.
 *
 * ## 1. Reel-only counters on the post fact
 *
 * A reel answers metrics a feed post does not, and vice versa. Until now one
 * metric list was sent for every surface, and because Meta refuses the *whole*
 * request when one metric does not apply to the media's product type, every
 * reel's insights call failed and no reel ever produced a row — see
 * `INSTAGRAM_REEL_LIFETIME_METRICS`. Fixing that read makes four more numbers
 * available per reel, and these are their columns.
 *
 * `reels_skip_rate` is the odd one and is stored differently on purpose. It is
 * a **percentage** (production returned `66.1`), and this table's rule is that
 * no ratio lives in it — a stored ratio gets averaged across rows with the
 * wrong weights the first time anyone aggregates. It is kept as basis points in
 * a `bigint`, so 66.1% is 6610: an integer, exact, and obviously not a counter
 * to anyone who reads the column name.
 *
 * ## 2. Story and reel slices on the period cache
 *
 * `reach_feed` already stores "Alcance das postagens" from the
 * `media_product_type` breakdown. The same breakdown carries STORY and REEL in
 * the same response, so their period reach and views cost nothing further —
 * verified against production on 2026-09-24, where 30 days gave POST 39,
 * STORY 105, REEL 11, CAROUSEL_CONTAINER 1 and AD 6 645 for reach.
 *
 * These are **subsets of the organic slice, not additive with it**, exactly as
 * `reach_feed` is: an account reached by both a story and a reel is one account
 * in `reach_organic` and one in each of the two columns.
 *
 * ## 3. A table for stories, because a story cannot be re-read
 *
 * Feed posts and reels are permanent: `/{ig-user}/media` still lists a reel
 * from last year, so a sync that misses one catches it tomorrow. A story exists
 * for 24 hours and then cannot be read at all — and it never appears in
 * `/{ig-user}/media` in the first place (verified: 378 items across four pages
 * of a real account, not one story). It is only ever on `/{ig-user}/stories`,
 * and only while it is live.
 *
 * So the stories fact table is not a cache of something re-derivable. It is the
 * only record that will ever exist, and a day the collector does not run is a
 * day of stories permanently lost. That is why it is a table of its own rather
 * than more columns on the post fact: the post fact's grain is "one observation
 * per day per post", which assumes the post can be observed again.
 *
 * The navigation counters — Avançar, Próximo story, Voltar, Sair — come from
 * the `navigation` metric broken down by `story_navigation_action_type`. They
 * are nullable because they could not be verified against the production
 * account: it has never had a story live while one was being observed, and an
 * expired story cannot be asked. The collector treats Meta refusing them as an
 * absent metric rather than a failed sync, for that reason.
 */
export class AddReelAndStoryMeasures1796300000000 implements MigrationInterface {
  name = 'AddReelAndStoryMeasures1796300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        -- Milliseconds, as Meta reports them. Not a counter and not summable
        -- across posts: it is already an average over one reel's views.
        ADD COLUMN IF NOT EXISTS "reels_avg_watch_time_ms" bigint,
        -- Milliseconds. This one IS additive across reels — it is total time.
        ADD COLUMN IF NOT EXISTS "reels_total_watch_time_ms" bigint,
        -- Basis points: 66.1% is stored as 6610. See the docblock.
        ADD COLUMN IF NOT EXISTS "reels_skip_rate_bp" bigint,
        ADD COLUMN IF NOT EXISTS "reposts_lifetime" bigint
    `);

    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        DROP CONSTRAINT IF EXISTS "CK_social_organic_post_metrics_daily_reels"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        ADD CONSTRAINT "CK_social_organic_post_metrics_daily_reels" CHECK (
          ("reels_avg_watch_time_ms" IS NULL OR "reels_avg_watch_time_ms" >= 0)
          AND ("reels_total_watch_time_ms" IS NULL
               OR "reels_total_watch_time_ms" >= 0)
          AND ("reposts_lifetime" IS NULL OR "reposts_lifetime" >= 0)
          -- A rate outside 0-100% is a parsing failure, not a small number.
          AND ("reels_skip_rate_bp" IS NULL
               OR ("reels_skip_rate_bp" >= 0 AND "reels_skip_rate_bp" <= 10000))
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        -- Subsets of "reach_organic"/"views_organic", never additive with it.
        ADD COLUMN IF NOT EXISTS "reach_reel" bigint,
        ADD COLUMN IF NOT EXISTS "reach_story" bigint,
        ADD COLUMN IF NOT EXISTS "views_feed" bigint,
        ADD COLUMN IF NOT EXISTS "views_reel" bigint,
        ADD COLUMN IF NOT EXISTS "views_story" bigint,
        -- The engagement family, split by the same breakdown. Verified on
        -- 2026-09-24: total_interactions, likes, comments, saves and shares all
        -- accept breakdown=media_product_type. "replies" does NOT — it answers
        -- with an opaque OAuthException — so story replies come from the
        -- un-broken-down account metric already collected.
        ADD COLUMN IF NOT EXISTS "interactions_reel" bigint,
        ADD COLUMN IF NOT EXISTS "interactions_story" bigint,
        ADD COLUMN IF NOT EXISTS "likes_reel" bigint,
        ADD COLUMN IF NOT EXISTS "comments_reel" bigint,
        ADD COLUMN IF NOT EXISTS "saves_reel" bigint,
        ADD COLUMN IF NOT EXISTS "shares_reel" bigint,
        ADD COLUMN IF NOT EXISTS "shares_story" bigint,
        -- Counted from the media listing, not from insights: "quantos reels no
        -- período" is a question about publications, and insights has no
        -- metric for it.
        ADD COLUMN IF NOT EXISTS "reel_count" integer,
        ADD COLUMN IF NOT EXISTS "story_count" integer
    `);

    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        DROP CONSTRAINT IF EXISTS "CK_social_organic_reach_periods_surfaces"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        ADD CONSTRAINT "CK_social_organic_reach_periods_surfaces" CHECK (
          ("reach_reel" IS NULL OR "reach_reel" >= 0)
          AND ("reach_story" IS NULL OR "reach_story" >= 0)
          AND ("views_feed" IS NULL OR "views_feed" >= 0)
          AND ("views_reel" IS NULL OR "views_reel" >= 0)
          AND ("views_story" IS NULL OR "views_story" >= 0)
          AND ("interactions_reel" IS NULL OR "interactions_reel" >= 0)
          AND ("interactions_story" IS NULL OR "interactions_story" >= 0)
          AND ("likes_reel" IS NULL OR "likes_reel" >= 0)
          AND ("comments_reel" IS NULL OR "comments_reel" >= 0)
          AND ("saves_reel" IS NULL OR "saves_reel" >= 0)
          AND ("shares_reel" IS NULL OR "shares_reel" >= 0)
          AND ("shares_story" IS NULL OR "shares_story" >= 0)
          AND ("reel_count" IS NULL OR "reel_count" >= 0)
          AND ("story_count" IS NULL OR "story_count" >= 0)
        )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_organic_stories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "asset_id" uuid NOT NULL,
        "provider" character varying(40) NOT NULL,
        "external_publication_id" character varying(191) NOT NULL,
        "published_at" timestamp with time zone,
        "media_type" character varying(40),
        "permalink" character varying(500),
        -- The creative. Meta signs media URLs with a ~5 day expiry, so what is
        -- stored is the id to re-resolve from, plus the URL for the window in
        -- which it still works. A story outlives its own signed URL by far, so
        -- a reader must treat "media_url" as best-effort and expect null.
        "media_url" character varying(1000),
        "thumbnail_url" character varying(1000),
        -- Lifetime counters as of "observed_at". A story's numbers keep moving
        -- for its 24 hours, so the last observation before it expires is the
        -- final one, and re-observing is how it gets there.
        "reach" bigint,
        "views" bigint,
        "replies" bigint,
        "shares" bigint,
        "total_interactions" bigint,
        "profile_visits" bigint,
        "follows" bigint,
        -- The navigation breakdown: how the viewer left this story.
        "nav_forward" bigint,
        "nav_next_story" bigint,
        "nav_back" bigint,
        "nav_exit" bigint,
        "observed_at" timestamp with time zone NOT NULL DEFAULT now(),
        -- The first time this story was seen live, which is as close to a
        -- capture timestamp as exists.
        "first_observed_at" timestamp with time zone NOT NULL DEFAULT now(),
        "sync_run_id" uuid,
        "created_at" timestamp with time zone NOT NULL DEFAULT now(),
        "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_organic_stories" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_social_organic_stories_publication"
          UNIQUE ("asset_id", "external_publication_id"),
        CONSTRAINT "FK_social_organic_stories_asset"
          FOREIGN KEY ("asset_id") REFERENCES "social_organic_assets"("id")
          ON DELETE CASCADE,
        CONSTRAINT "CK_social_organic_stories_non_negative" CHECK (
          ("reach" IS NULL OR "reach" >= 0)
          AND ("views" IS NULL OR "views" >= 0)
          AND ("replies" IS NULL OR "replies" >= 0)
          AND ("shares" IS NULL OR "shares" >= 0)
          AND ("total_interactions" IS NULL OR "total_interactions" >= 0)
          AND ("profile_visits" IS NULL OR "profile_visits" >= 0)
          AND ("follows" IS NULL OR "follows" >= 0)
          AND ("nav_forward" IS NULL OR "nav_forward" >= 0)
          AND ("nav_next_story" IS NULL OR "nav_next_story" >= 0)
          AND ("nav_back" IS NULL OR "nav_back" >= 0)
          AND ("nav_exit" IS NULL OR "nav_exit" >= 0)
        )
      )
    `);

    // The ranking query: the best stories of a period for one asset. Ordering
    // is done in SQL over the scope, so the scope and the date lead.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_stories_scope"
        ON "social_organic_stories"
        ("tenant_id", "workspace_id", "agency_client_id", "published_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_stories_asset_published"
        ON "social_organic_stories" ("asset_id", "published_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_social_organic_stories_asset_published"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_social_organic_stories_scope"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_organic_stories"`);

    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        DROP CONSTRAINT IF EXISTS "CK_social_organic_reach_periods_surfaces"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        DROP COLUMN IF EXISTS "reach_reel",
        DROP COLUMN IF EXISTS "reach_story",
        DROP COLUMN IF EXISTS "views_feed",
        DROP COLUMN IF EXISTS "views_reel",
        DROP COLUMN IF EXISTS "views_story",
        DROP COLUMN IF EXISTS "interactions_reel",
        DROP COLUMN IF EXISTS "interactions_story",
        DROP COLUMN IF EXISTS "likes_reel",
        DROP COLUMN IF EXISTS "comments_reel",
        DROP COLUMN IF EXISTS "saves_reel",
        DROP COLUMN IF EXISTS "shares_reel",
        DROP COLUMN IF EXISTS "shares_story",
        DROP COLUMN IF EXISTS "reel_count",
        DROP COLUMN IF EXISTS "story_count"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        DROP CONSTRAINT IF EXISTS "CK_social_organic_post_metrics_daily_reels"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        DROP COLUMN IF EXISTS "reels_avg_watch_time_ms",
        DROP COLUMN IF EXISTS "reels_total_watch_time_ms",
        DROP COLUMN IF EXISTS "reels_skip_rate_bp",
        DROP COLUMN IF EXISTS "reposts_lifetime"
    `);
  }
}
