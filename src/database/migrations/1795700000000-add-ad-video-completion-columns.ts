import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds ThruPlays and watch time as columns of their own.
 *
 * Meta has no single number called "video views". A play, a three-second view, a
 * ThruPlay and a 25%/100% completion are five different measurements of the same
 * impression, and on this account over the same 90 days the same campaign
 * reported 4 877 plays, 872 three-second views and 190 ThruPlays — a 25x spread
 * between the widest and the narrowest. The existing `video_views` column holds
 * the `video_view` action type, which is the three-second one.
 *
 * `meta-action-mapping.ts` states the rule this migration follows: a slice that
 * wants ThruPlays or completions "needs new columns and a mapping version — not
 * a redefinition of this one, which would change the meaning of every row
 * already stored". Widening `video_views` to mean ThruPlays would silently
 * restate 83 days of history, and no reader could tell which definition a given
 * row followed.
 *
 * **Why this is worth the quota.** `ads_insights` is metered on CPU time against
 * a quota shared with the publishing path, so a column is never free. This one
 * earns it: Boost already sells ThruPlay as an optimization goal, and a product
 * that spends a client's budget optimizing for an outcome it cannot then report
 * is asking them to take the result on faith.
 *
 * Nullable with no default, unlike the counters beside them which default to 0.
 * These columns start life not-measured for every row already stored, and a
 * zero would claim we asked Meta and it answered none. `raw` is empty on every
 * existing row, so there is nothing to backfill from and no honest way to
 * reconstruct them — they fill from the next sync forward, and the gap before
 * that is visible as NULL rather than disguised as zero.
 */
export class AddAdVideoCompletionColumns1795700000000
  implements MigrationInterface
{
  name = 'AddAdVideoCompletionColumns1795700000000';

  private static readonly TABLES = [
    'social_ad_metrics_daily',
    'social_ad_breakdown_daily',
  ] as const;

  /**
   * Each table's existing `_non_negative` body, restated so the new terms can
   * be appended to it.
   *
   * Copied from the live definitions rather than rebuilt from the entities:
   * the two tables guard different column sets — the breakdown table has no
   * `leads`, `conversions`, `conversion_value` or `video_views` — and a
   * constraint that named a column the table lacks would fail at ADD time.
   */
  private static readonly BASE_CHECK: Record<string, string> = {
    social_ad_metrics_daily: `"spend" >= 0
       AND "impressions" >= 0
       AND "clicks" >= 0
       AND "link_clicks" >= 0
       AND "leads" >= 0
       AND "conversions" >= 0
       AND "conversion_value" >= 0
       AND "video_views" >= 0
       AND ("reach" IS NULL OR "reach" >= 0)`,
    social_ad_breakdown_daily: `"spend" >= 0
       AND "impressions" >= 0
       AND "clicks" >= 0
       AND "link_clicks" >= 0
       AND ("reach" IS NULL OR "reach" >= 0)`,
  };

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of AddAdVideoCompletionColumns1795700000000.TABLES) {
      // Present on the breakdown table too, so "ThruPlays by placement" is a
      // question that can be answered later without a second migration and a
      // second backfill gap. A breakdown row that never carries the value is a
      // NULL column; a missing column is a schema change under a live reader.
      await queryRunner.query(
        `ALTER TABLE "${table}"
           ADD COLUMN IF NOT EXISTS "thruplays" bigint`,
      );
      // `numeric`, not `bigint`, and named `avg` rather than `total`, because
      // `video_avg_time_watched_actions` is a MEAN in seconds per view. Meta
      // offers no total watch time on this edge, and reconstructing one by
      // multiplying by a view count would pair this average's denominator with
      // a different metric's numerator. Summing this column across days is
      // always wrong; the read layer computes a view-weighted average instead.
      await queryRunner.query(
        `ALTER TABLE "${table}"
           ADD COLUMN IF NOT EXISTS "video_avg_watch_seconds" numeric(12,4)`,
      );
      // Folded into the table's existing non-negative constraint rather than
      // added beside it, matching what the entities declare. Two constraints
      // guarding the same kind of thing on the same table means a rejected
      // write names whichever one happened to fire first.
      await queryRunner.query(
        `ALTER TABLE "${table}"
           DROP CONSTRAINT IF EXISTS "CK_${table}_non_negative"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}"
           ADD CONSTRAINT "CK_${table}_non_negative"
           CHECK (${AddAdVideoCompletionColumns1795700000000.BASE_CHECK[table]}
              AND ("thruplays" IS NULL OR "thruplays" >= 0)
              AND ("video_avg_watch_seconds" IS NULL
                   OR "video_avg_watch_seconds" >= 0))`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of AddAdVideoCompletionColumns1795700000000.TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}"
           DROP CONSTRAINT IF EXISTS "CK_${table}_non_negative"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}"
           ADD CONSTRAINT "CK_${table}_non_negative"
           CHECK (${AddAdVideoCompletionColumns1795700000000.BASE_CHECK[table]})`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "thruplays"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}"
           DROP COLUMN IF EXISTS "video_avg_watch_seconds"`,
      );
    }
  }
}
