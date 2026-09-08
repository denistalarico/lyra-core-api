import type { MigrationInterface, QueryRunner } from 'typeorm';

const NEW_LIFETIME_COLUMNS = [
  'impressions_lifetime',
  'likes_lifetime',
  'comments_lifetime',
  'video_views_lifetime',
] as const;

const ORIGINAL_CHECK_EXPRESSION = `"impressions" >= 0
   AND "reach" >= 0
   AND "likes" >= 0
   AND "comments" >= 0
   AND "shares" >= 0
   AND "saves" >= 0
   AND "video_views" >= 0
   AND "watch_time_seconds" >= 0
   AND "link_clicks" >= 0
   AND "profile_visits" >= 0`;

const EXTENDED_CHECK_EXPRESSION = `${ORIGINAL_CHECK_EXPRESSION}
   AND "impressions_lifetime" >= 0
   AND "likes_lifetime" >= 0
   AND "comments_lifetime" >= 0
   AND "video_views_lifetime" >= 0`;

/**
 * Meta v26 exposes the only candidate Page-post/IG-media counters
 * (`post_media_view`; `comments`/`likes`/`views`) as `period=lifetime`
 * cumulative snapshots, never as a daily flow. `social_organic_post_metrics_daily`
 * is an explicit daily-flow grain (A1, blueprint §15.2), so writing a lifetime
 * total into a flow column would fabricate a value that was never observed.
 *
 * This migration adds four structurally separate SNAPSHOT columns (paired with
 * their own `*_observed_at` instant) rather than reusing the flow columns above.
 * A snapshot row is stamped at the day Lyra observed it (`currentDay` of the
 * sync, not the post's publish day) and is never summed or averaged across
 * days — only the latest observation in a period is ever read.
 */
export class AddSocialOrganicPostLifetimeSnapshots1792400000000 implements MigrationInterface {
  name = 'AddSocialOrganicPostLifetimeSnapshots1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        ADD COLUMN "impressions_lifetime" bigint,
        ADD COLUMN "impressions_lifetime_observed_at" timestamptz,
        ADD COLUMN "likes_lifetime" bigint,
        ADD COLUMN "likes_lifetime_observed_at" timestamptz,
        ADD COLUMN "comments_lifetime" bigint,
        ADD COLUMN "comments_lifetime_observed_at" timestamptz,
        ADD COLUMN "video_views_lifetime" bigint,
        ADD COLUMN "video_views_lifetime_observed_at" timestamptz
    `);

    // Postgres has no `ALTER CONSTRAINT`: the non-negative CHECK is dropped and
    // re-added widened to also cover the 4 new bigint counters.
    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        DROP CONSTRAINT "CK_social_organic_post_metrics_daily_non_negative"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        ADD CONSTRAINT "CK_social_organic_post_metrics_daily_non_negative"
        CHECK (${EXTENDED_CHECK_EXPRESSION})
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        DROP CONSTRAINT "CK_social_organic_post_metrics_daily_non_negative"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_post_metrics_daily"
        ADD CONSTRAINT "CK_social_organic_post_metrics_daily_non_negative"
        CHECK (${ORIGINAL_CHECK_EXPRESSION})
    `);

    for (const column of NEW_LIFETIME_COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "social_organic_post_metrics_daily" DROP COLUMN "${column}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "social_organic_post_metrics_daily" DROP COLUMN "${column}_observed_at"`,
      );
    }
  }
}
