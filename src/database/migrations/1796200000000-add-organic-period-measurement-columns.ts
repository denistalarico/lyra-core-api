import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widens the period-measurement cache from one number to six.
 *
 * `social_organic_reach_periods` stored a single `reach`, which is the total —
 * ads included. Meanwhile `MetaOrganicPeriodReachService.measurePeriod` already
 * reads six figures from the same two API calls: views and reach, each as a
 * total plus its organic and paid slices. Five of them were being computed and
 * thrown away, so the read layer had no way to answer "alcance total, e quanto
 * dele foi pago" without spending quota again on a dashboard load.
 *
 * ## Why the columns rather than a second table
 *
 * These are six readings of the same window taken in the same request. A
 * separate table would let them disagree about which window they describe, and
 * there is no query that wants one without the others.
 *
 * ## Every column is nullable, and null is not zero
 *
 * Meta answers the slices only when it returns a breakdown. A window it did not
 * split has a real total and unknown slices, which must read as null: a zero
 * would state that nothing was paid, and on an account that ran ads all month
 * that is a confident lie. The existing `reach` column keeps its meaning
 * exactly — it is the total — and `reach_total` is deliberately NOT added as a
 * duplicate of it.
 *
 * ## No backfill
 *
 * Unlike migration 1796000000000, which recovered the daily totals from
 * `provider_metrics` because the raw payload had been kept, nothing here can be
 * recovered: the slices were never persisted in any form. Existing rows keep
 * their total and carry null slices until the next sync re-measures the window,
 * which happens on every run for the four standard windows.
 */
export class AddOrganicPeriodMeasurementColumns1796200000000 implements MigrationInterface {
  name = 'AddOrganicPeriodMeasurementColumns1796200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        ADD COLUMN IF NOT EXISTS "reach_organic" bigint,
        ADD COLUMN IF NOT EXISTS "reach_paid" bigint,
        -- Feed posts alone ("Alcance das postagens"): a subset of
        -- "reach_organic", since reels and stories are organic too.
        ADD COLUMN IF NOT EXISTS "reach_feed" bigint,
        ADD COLUMN IF NOT EXISTS "views" bigint,
        ADD COLUMN IF NOT EXISTS "views_organic" bigint,
        ADD COLUMN IF NOT EXISTS "views_paid" bigint,
        -- The range Meta actually measured, which the 30-day clamp may have
        -- narrowed. Stored so a card can say so instead of labelling a 30-day
        -- figure with the 90-day period the operator asked for.
        ADD COLUMN IF NOT EXISTS "measured_since" date,
        ADD COLUMN IF NOT EXISTS "measured_until" date,
        ADD COLUMN IF NOT EXISTS "truncated" boolean NOT NULL DEFAULT false
    `);

    // Folded into one constraint rather than six: they are one rule, and a
    // single name makes a violation report which table-wide invariant broke.
    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        DROP CONSTRAINT IF EXISTS "CK_social_organic_reach_periods_measures"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        ADD CONSTRAINT "CK_social_organic_reach_periods_measures"
        CHECK (
          ("reach_organic" IS NULL OR "reach_organic" >= 0)
          AND ("reach_paid" IS NULL OR "reach_paid" >= 0)
          AND ("reach_feed" IS NULL OR "reach_feed" >= 0)
          AND ("views" IS NULL OR "views" >= 0)
          AND ("views_organic" IS NULL OR "views_organic" >= 0)
          AND ("views_paid" IS NULL OR "views_paid" >= 0)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        DROP CONSTRAINT IF EXISTS "CK_social_organic_reach_periods_measures"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_reach_periods"
        DROP COLUMN IF EXISTS "reach_organic",
        DROP COLUMN IF EXISTS "reach_paid",
        DROP COLUMN IF EXISTS "reach_feed",
        DROP COLUMN IF EXISTS "views",
        DROP COLUMN IF EXISTS "views_organic",
        DROP COLUMN IF EXISTS "views_paid",
        DROP COLUMN IF EXISTS "measured_since",
        DROP COLUMN IF EXISTS "measured_until",
        DROP COLUMN IF EXISTS "truncated"
    `);
  }
}
