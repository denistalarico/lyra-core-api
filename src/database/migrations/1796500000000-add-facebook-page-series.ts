import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The daily columns behind the Facebook Page charts.
 *
 * ## Why the follower series could not use the column that already exists
 *
 * `social_organic_account_metrics_daily.followers_count` is written from
 * `GET /{page}?fields=followers_count`, which answers "how many followers
 * *now*" and nothing else. The sync writes that one number onto whichever day
 * it is syncing, so in production every historical row carries today's value:
 * 150 on 2026-09-20 through 2026-09-25, on a Page that actually went 148 → 150
 * over that window.
 *
 * A growth chart drawn from that column is a flat line that is *wrong* — not a
 * gap a reader can see, but a plausible-looking answer to the question the card
 * asks. So the series gets its own column, `page_follows`, fed by the Page
 * insights metric of the same name, which returns the real end-of-day level per
 * day and can be requested retroactively.
 *
 * `followers_count` is deliberately left alone. It is still the honest answer to
 * "what is the level right now", which is what the KPI card reads, and
 * overwriting historical rows would destroy the record of what was observed
 * when. Two columns, two questions.
 *
 * ## Why geography lands in the audience table and not here
 *
 * `page_follows_city` and `page_follows_country` are **lifetime stocks**: each
 * day's entry is the whole distribution as of that day, not that day's new
 * followers. Verified on 2026-09-25 — a one-day window and a ninety-day window
 * return the same 45 city buckets.
 *
 * They therefore belong in `social_organic_audience_daily`, whose entire
 * contract is "a snapshot that is never summed across days", and which already
 * has the `city` and `country` kinds from the Instagram side. No column is
 * added for them here; only the Facebook branch of the audience collector
 * changes.
 *
 * Worth recording because the names look retired and are not:
 * `page_fans_city` and `page_fans_country` answer `(#100) The value must be a
 * valid insights metric`, and this project concluded from that the Page had no
 * geography left. The replacements exist, but answer **only** with
 * `period=day`; with `period=lifetime` — the period the retired metric used —
 * they return `{"data": []}` with no error at all. A silent empty is why they
 * were read as gone.
 *
 * ## Why the views split is two columns and not a breakdown row
 *
 * `page_media_view` is already collected daily with `breakdown=is_from_ads`,
 * and the organic half already lands in `impressions`. The paid half was being
 * read and discarded. These two columns keep both, for the same reason the post
 * table keeps `views_organic_lifetime` and `views_paid_lifetime` separately:
 * Meta measures them separately, and a caller that wants the sum can add two
 * numbers it can see, while a caller given only the sum cannot recover either.
 */
export class AddFacebookPageSeries1796500000000 implements MigrationInterface {
  name = 'AddFacebookPageSeries1796500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_organic_account_metrics_daily"
        ADD COLUMN IF NOT EXISTS "page_follows" bigint,
        ADD COLUMN IF NOT EXISTS "page_daily_follows" bigint,
        ADD COLUMN IF NOT EXISTS "page_daily_unfollows" bigint,
        ADD COLUMN IF NOT EXISTS "views_organic" bigint,
        ADD COLUMN IF NOT EXISTS "views_paid" bigint,
        ADD COLUMN IF NOT EXISTS "new_conversations" bigint
    `);

    await queryRunner.query(`
      ALTER TABLE "social_organic_account_metrics_daily"
        DROP CONSTRAINT IF EXISTS "CK_social_organic_account_metrics_daily_page_series"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_account_metrics_daily"
        ADD CONSTRAINT "CK_social_organic_account_metrics_daily_page_series"
        CHECK (
          ("page_follows" IS NULL OR "page_follows" >= 0)
          AND ("page_daily_follows" IS NULL OR "page_daily_follows" >= 0)
          AND ("page_daily_unfollows" IS NULL OR "page_daily_unfollows" >= 0)
          AND ("views_organic" IS NULL OR "views_organic" >= 0)
          AND ("views_paid" IS NULL OR "views_paid" >= 0)
          AND ("new_conversations" IS NULL OR "new_conversations" >= 0)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_organic_account_metrics_daily"
        DROP CONSTRAINT IF EXISTS "CK_social_organic_account_metrics_daily_page_series"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_account_metrics_daily"
        DROP COLUMN IF EXISTS "page_follows",
        DROP COLUMN IF EXISTS "page_daily_follows",
        DROP COLUMN IF EXISTS "page_daily_unfollows",
        DROP COLUMN IF EXISTS "views_organic",
        DROP COLUMN IF EXISTS "views_paid",
        DROP COLUMN IF EXISTS "new_conversations"
    `);
  }
}
