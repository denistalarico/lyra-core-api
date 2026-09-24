import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stores the **total** account views and reach — the figures that include ads —
 * beside the organic-only ones already in `impressions` and `reach`.
 *
 * ## Why the existing columns are not these numbers
 *
 * The account sync asks for `views` and `reach` with
 * `breakdown=media_product_type`, and the normalizer sums every surface except
 * `AD` (`readNonAdMediaProducts`). That is the right figure for an *organic*
 * table and it is what those two columns have always held. It is not the number
 * an operator means by "visualizações totais".
 *
 * The gap is not small. On the account this was written against, the 30 days to
 * 2026-09-24 were 9.155 views of which 8.646 were `AD`, and 6.783 reach of
 * which 6.645 was `AD` — the stored organic figure was under 6% of the total.
 * A dashboard showing 509 where Meta's app shows 9.155 does not read as a
 * different metric; it reads as broken.
 *
 * ## Both, not one
 *
 * The organic columns stay exactly as they are. Meta reports the total as its
 * own de-duplicated measurement, not as organic + paid: an account reached both
 * organically and by an ad is counted once in the total and once in each slice,
 * so the slices do not add up to it and the difference is not an error. Keeping
 * the three lets a card show the total Meta vouches for and still break it into
 * organic and paid, which is what was asked for — and it is the only honest way
 * to do it, because deriving the paid slice as `total - organic` would invent a
 * number Meta never stated.
 *
 * ## The backfill costs nothing
 *
 * `provider_metrics` has held the whole payload since collection began, and the
 * total sits at `total_value.value` with the breakdown beside it. Every day
 * already collected can be recovered with one UPDATE and no provider call —
 * the same reasoning as migration 1795600000000, which recovered the engagement
 * counters the same way. Meta's account insights have a short retention window,
 * so a column added without this would be permanently blank for those days.
 */
export class AddOrganicAccountTotalReachViews1796000000000
  implements MigrationInterface
{
  name = 'AddOrganicAccountTotalReachViews1796000000000';

  /**
   * The column to fill paired with the provider metric it is read from.
   *
   * Both halves are interpolated into SQL below, so both are constrained to
   * identifiers declared here rather than coming from anywhere a caller could
   * influence.
   */
  private static readonly COLUMNS: ReadonlyArray<{
    column: string;
    metric: string;
  }> = [
    { column: 'views_total', metric: 'views' },
    { column: 'reach_total', metric: 'reach' },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { column } of AddOrganicAccountTotalReachViews1796000000000
      .COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "social_organic_account_metrics_daily"
           ADD COLUMN IF NOT EXISTS "${column}" bigint`,
      );
    }

    // `jsonb_typeof(...) = 'number'` rather than a bare cast, for the reason
    // migration 1795600000000 gives: a metric requested with a breakdown can
    // answer with an object in this position, and casting that to bigint would
    // abort the migration. Anything that is not a number is left for the next
    // sync to write.
    //
    // `WHERE "<column>" IS NULL` keeps this idempotent and stops an older
    // payload overwriting a value a newer sync already wrote.
    for (const { column, metric } of AddOrganicAccountTotalReachViews1796000000000
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

    // Folded into the existing check rather than added as two more, matching
    // what 1795600000000 did to the same constraint.
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
            AND "replies" >= 0
            AND "views_total" >= 0
            AND "reach_total" >= 0)`,
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
            AND "profile_views" >= 0
            AND "total_interactions" >= 0
            AND "accounts_engaged" >= 0
            AND "likes" >= 0
            AND "comments" >= 0
            AND "shares" >= 0
            AND "saves" >= 0
            AND "replies" >= 0)`,
    );

    // Nothing is lost: `provider_metrics` still holds every payload these were
    // filled from, which is what makes the backfill in `up()` repeatable.
    for (const { column } of AddOrganicAccountTotalReachViews1796000000000
      .COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "social_organic_account_metrics_daily"
           DROP COLUMN IF EXISTS "${column}"`,
      );
    }
  }
}
