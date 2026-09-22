import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a post *is*, beside what it measured.
 *
 * The post fact table could say a publication reached 400 people and could not
 * say which publication that was. Everything identifying it —
 * `external_publication_id` aside — lived in `social_publications`, which only
 * holds content Lyra itself published: one row here, against 326 on the
 * account. A "best posts" table built on that join would have been a table of
 * one row, so discovery moves to the provider and the identity travels with the
 * fact.
 *
 * **`media_url` is deliberately not a column.** Meta's CDN URLs are signed and
 * expire in about five days (the `oe` parameter is an epoch), so a stored one
 * renders for a while and then silently 403s — the kind of failure nobody
 * connects back to the column that caused it. The stable identifiers are
 * `external_publication_id` and `permalink`; the image itself is re-resolved on
 * demand through the backend proxy, which is why only those two are persisted.
 *
 * The engagement columns are nullable with no default, like every other metric
 * column on this table: null is "not collected", zero is "collected and it was
 * zero", and a default would erase that distinction on every historical row.
 *
 * They are all `*_lifetime`, and that suffix is load-bearing rather than
 * decorative. `/{ig-media-id}/insights` reports a post's reach, saves, shares
 * and follows as cumulative totals since publication — so writing them into the
 * existing flow columns (`reach`, `shares`, `saves`) would invite a reader to
 * sum them across days and count the same person once per day the sync ran.
 * The table already draws this distinction for impressions, likes, comments and
 * video views; these follow the same rule, sharing one `lifetime_observed_at`
 * because a single request observes all of them at the same instant.
 */
export class AddSocialOrganicPostIdentity1795400000000 implements MigrationInterface {
  name = 'AddSocialOrganicPostIdentity1795400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        ADD COLUMN IF NOT EXISTS "permalink" varchar(500),
        ADD COLUMN IF NOT EXISTS "caption" text,
        ADD COLUMN IF NOT EXISTS "media_type" varchar(40),
        ADD COLUMN IF NOT EXISTS "media_product_type" varchar(40),
        ADD COLUMN IF NOT EXISTS "published_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "reach_lifetime" bigint,
        ADD COLUMN IF NOT EXISTS "saves_lifetime" bigint,
        ADD COLUMN IF NOT EXISTS "shares_lifetime" bigint,
        ADD COLUMN IF NOT EXISTS "total_interactions_lifetime" bigint,
        ADD COLUMN IF NOT EXISTS "profile_visits_lifetime" bigint,
        ADD COLUMN IF NOT EXISTS "follows_lifetime" bigint,
        ADD COLUMN IF NOT EXISTS "lifetime_observed_at" timestamptz
    `);

    // Sorting a "best posts" table means ordering by a metric within one
    // asset's window — the same three columns every such query filters on.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_post_metrics_ranking"
        ON "social_organic_post_metrics_daily"
          ("tenant_id", "workspace_id", "asset_id", "metric_date")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_organic_post_metrics_ranking"',
    );
    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        DROP COLUMN IF EXISTS "lifetime_observed_at",
        DROP COLUMN IF EXISTS "follows_lifetime",
        DROP COLUMN IF EXISTS "profile_visits_lifetime",
        DROP COLUMN IF EXISTS "total_interactions_lifetime",
        DROP COLUMN IF EXISTS "shares_lifetime",
        DROP COLUMN IF EXISTS "saves_lifetime",
        DROP COLUMN IF EXISTS "reach_lifetime",
        DROP COLUMN IF EXISTS "published_at",
        DROP COLUMN IF EXISTS "media_product_type",
        DROP COLUMN IF EXISTS "media_type",
        DROP COLUMN IF EXISTS "caption",
        DROP COLUMN IF EXISTS "permalink"
    `);
  }
}
