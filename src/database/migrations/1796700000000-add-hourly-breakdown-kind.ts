import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Admits `hourly` to the breakdown dimensions `social_ad_breakdown_daily` holds.
 *
 * ## Why the CHECK exists at all, and why widening it is the whole migration
 *
 * `breakdown_kind` is constrained rather than open — the opposite of `source` on
 * the facts table — because a new dimension never arrives alone: it arrives with
 * a reader that has to know how to label its keys and a chart that has to know
 * whether its buckets may be summed. The constraint is the place that mistake
 * surfaces, so widening it deliberately is a migration and not a config change.
 *
 * Nothing else changes. No column, no index, no backfill. The row shape a
 * daypart occupies is the shape an age/gender cell already occupies, and
 * `IDX_social_ad_breakdown_daily_read` already leads with `breakdown_kind`, so
 * the new dimension's reads land on the index that exists.
 *
 * ## The stored key is `h09`, not `09:00:00 - 09:59:59`
 *
 * Meta's own value for this dimension is a 19-character range string with
 * spaces and colons in it. Every other key in this column is a lowercase token
 * (`mobile_app`, `25-34|female`), and the normalizer validates that alphabet
 * precisely so that an unreadable key is refused rather than stored — a rule
 * worth keeping, since the alternative is an unlabelled slice in a chart.
 *
 * So the normalizer folds the range to `h00`…`h23` before storing. The fold is
 * lossless in both directions: the ranges are the 24 whole hours of a day and
 * nothing else, the start hour identifies each one uniquely, and the label is
 * re-derived on read like every other label in this table. Sorting a daypart
 * chart then works on the key itself, which a range string would not do
 * correctly past `09` — `"10:00:00 - …"` sorts before `"9:..."` only by
 * accident of Meta's zero padding, and depending on that is depending on a
 * formatting choice nobody promised to keep.
 *
 * ## Reach is not collected for this dimension, and cannot be
 *
 * Stated here because the schema cannot express it: `reach` on this table is
 * nullable and hourly rows will carry it as Meta reports it, but the *period*
 * view already returns `reach: null` for every bucket of every dimension, and
 * for this one the reason is sharper than usual. Measured against this
 * account's own 90-day window, the hourly buckets sum to 7 319 people where the
 * day-level figure is 6 620 — a 10.6% inflation from people reached in more
 * than one hour of the same day. Impressions over the same window sum to 9 038
 * from both sides, exactly. Impressions per hour is an honest sum; reach per
 * hour is not, in any window.
 */
export class AddHourlyBreakdownKind1796700000000 implements MigrationInterface {
  name = 'AddHourlyBreakdownKind1796700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_ad_breakdown_daily"
        DROP CONSTRAINT IF EXISTS "CK_social_ad_breakdown_daily_kind"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_ad_breakdown_daily"
        ADD CONSTRAINT "CK_social_ad_breakdown_daily_kind"
        CHECK ("breakdown_kind" IN (
          'age_gender',
          'device_platform',
          'publisher_platform',
          'hourly'
        ))
    `);
  }

  /**
   * Narrows the constraint back, and deletes the rows that would violate it.
   *
   * The delete is not incidental — `ADD CONSTRAINT` fails against existing rows,
   * so a `down` that only restored the constraint would be a `down` that cannot
   * run on any database where the feature was used. Deleting is safe in the way
   * the messaging-conversations migration's column drop was safe: every hourly
   * row is re-readable from Meta for the retention window the account keeps, so
   * nothing is lost here that a re-ingest cannot rebuild.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "social_ad_breakdown_daily" WHERE "breakdown_kind" = 'hourly'
    `);

    await queryRunner.query(`
      ALTER TABLE "social_ad_breakdown_daily"
        DROP CONSTRAINT IF EXISTS "CK_social_ad_breakdown_daily_kind"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_ad_breakdown_daily"
        ADD CONSTRAINT "CK_social_ad_breakdown_daily_kind"
        CHECK ("breakdown_kind" IN (
          'age_gender',
          'device_platform',
          'publisher_platform'
        ))
    `);
  }
}
