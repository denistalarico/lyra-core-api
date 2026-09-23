import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Promotes six account-level engagement counters out of `provider_metrics` and
 * into columns of their own, and backfills them from the JSONB already stored.
 *
 * These are not new measurements. `INSTAGRAM_ACCOUNT_ENGAGEMENT_METRICS` has
 * been requesting all of them on every sync since it was written — the read
 * costs nothing extra because they share one call — and the normalizer has been
 * dropping every one except `profile_views` into `provider_metrics` with a
 * comment saying they live there "until columns exist for them". This is that
 * migration. Production holds 22 days of them at the time of writing.
 *
 * **The backfill is the reason this migration is worth its weight.** Meta's
 * account insights are `period=day` reads with a limited retention window, so a
 * column added without a backfill would start empty and stay empty for the days
 * already behind us — the history would have been collected, stored, and then
 * quietly discarded at the moment we finally gave it somewhere to live. Reading
 * it back out of `provider_metrics` costs one UPDATE and recovers all of it.
 *
 * Every one of these is a daily flow and may be summed across days, which is why
 * they are ordinary counters rather than `*_lifetime` snapshot columns: Meta
 * reports them per day for the day, not cumulatively since the account opened.
 * `accounts_engaged` is the one to be careful with — it counts distinct accounts
 * within its day, so summing it across days counts a person once per day they
 * engaged. It is stored as a flow because that is what the provider returns, and
 * the read layer is where that caveat is enforced.
 *
 * `profile_views` already has a column and is deliberately absent here.
 */
export class AddOrganicAccountEngagementColumns1795600000000
  implements MigrationInterface
{
  name = 'AddOrganicAccountEngagementColumns1795600000000';

  /**
   * The provider's metric name paired with the column it lands in.
   *
   * Both halves are interpolated into SQL below, so both are constrained to
   * identifiers here rather than coming from anywhere a caller could influence.
   */
  private static readonly COLUMNS: ReadonlyArray<{
    column: string;
    metric: string;
  }> = [
    { column: 'total_interactions', metric: 'total_interactions' },
    { column: 'accounts_engaged', metric: 'accounts_engaged' },
    { column: 'likes', metric: 'likes' },
    { column: 'comments', metric: 'comments' },
    { column: 'shares', metric: 'shares' },
    { column: 'saves', metric: 'saves' },
    { column: 'replies', metric: 'replies' },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { column } of AddOrganicAccountEngagementColumns1795600000000
      .COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "social_organic_account_metrics_daily"
           ADD COLUMN IF NOT EXISTS "${column}" bigint`,
      );
    }

    // Recover the history already sitting in `provider_metrics`.
    //
    // `jsonb_typeof(...) = 'number'` rather than a bare cast: the engagement
    // metrics answer with a plain `total_value.value`, but a metric that was
    // requested with a breakdown answers with an object in the same position,
    // and casting that to bigint would abort the whole migration. Anything that
    // is not a number is left for the normalizer to handle on the next sync.
    //
    // `WHERE "<column>" IS NULL` keeps this idempotent and makes re-running it
    // safe: a value already written by a newer sync is never overwritten by the
    // older payload that happens to still be in the JSONB.
    for (const { column, metric } of AddOrganicAccountEngagementColumns1795600000000
      .COLUMNS) {
      await queryRunner.query(
        `UPDATE "social_organic_account_metrics_daily"
            SET "${column}" =
                  ("provider_metrics" -> '${metric}' -> 'total_value' ->> 'value')::bigint
          WHERE "${column}" IS NULL
            AND jsonb_typeof(
                  "provider_metrics" -> '${metric}' -> 'total_value' -> 'value'
                ) = 'number'`,
      );
    }

    // Folded into the existing non-negative check rather than added as seven
    // more: one constraint name is one thing to find when a write is rejected,
    // and the columns it guards are all the same kind of number.
    await queryRunner.query(
      `ALTER TABLE "social_organic_account_metrics_daily"
         DROP CONSTRAINT IF EXISTS "CK_social_organic_account_metrics_daily_non_negative"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_organic_account_metrics_daily"
         ADD CONSTRAINT "CK_social_organic_account_metrics_daily_non_negative"
         CHECK ("followers_count" >= 0
            AND "followers_gained" >= 0
            AND "followers_lost" >= 0
            AND "impressions" >= 0
            AND "reach" >= 0
            AND "profile_views" >= 0
            AND "total_interactions" >= 0
            AND "accounts_engaged" >= 0
            AND "likes" >= 0
            AND "comments" >= 0
            AND "shares" >= 0
            AND "saves" >= 0
            AND "replies" >= 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_organic_account_metrics_daily"
         DROP CONSTRAINT IF EXISTS "CK_social_organic_account_metrics_daily_non_negative"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_organic_account_metrics_daily"
         ADD CONSTRAINT "CK_social_organic_account_metrics_daily_non_negative"
         CHECK ("followers_count" >= 0
            AND "followers_gained" >= 0
            AND "followers_lost" >= 0
            AND "impressions" >= 0
            AND "reach" >= 0
            AND "profile_views" >= 0)`,
    );

    // The data is not lost by dropping these: `provider_metrics` still holds
    // every payload these columns were filled from, which is what makes the
    // backfill in `up()` repeatable.
    for (const { column } of AddOrganicAccountEngagementColumns1795600000000
      .COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "social_organic_account_metrics_daily"
           DROP COLUMN IF EXISTS "${column}"`,
      );
    }
  }
}
