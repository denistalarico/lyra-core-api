import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A middle state between "nothing to accept yet" and "formally cleared by
 * legal" (Lyra Social I6.2).
 *
 * `legal_review_status` (migration 1788200000000) had exactly three values —
 * `pending`, `approved`, `rejected` — and every place that reads it treats
 * `approved` as a genuine legal sign-off: the seed service's own comment says
 * "flipping this is a legal decision, not a code change", and both `optIn` and
 * `collectSnapshot` refuse until it reads `approved`. Writing `approved` on a
 * text that has not actually cleared legal review would be a false claim
 * encoded in the database, not a UI label, and it would simultaneously
 * de-fence real production collection through the very same column.
 *
 * `provisional` is the missing state: a text live enough for a user to give
 * or withdraw explicit consent — so the product can be exercised end to end —
 * while remaining honestly unreviewed. `optIn` and `collectSnapshot` both
 * treat it exactly like `approved` (I6.2 decision): the platform gate
 * (`LEADFLOW_PRODUCT_TELEMETRY_ENABLED`), which stays off, is what actually
 * keeps production from collecting before legal signs off — not this column.
 * `approved` keeps its original meaning untouched; nothing that already reads
 * `approved` changes behaviour.
 */
export class AddProvisionalLegalReviewStatus1791300000000 implements MigrationInterface {
  name = 'AddProvisionalLegalReviewStatus1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leadflow_telemetry_consent_notices"
        DROP CONSTRAINT "CK_lf_telemetry_notice_legal_review"
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_telemetry_consent_notices"
        ADD CONSTRAINT "CK_lf_telemetry_notice_legal_review"
        CHECK ("legal_review_status" IN ('pending', 'provisional', 'approved', 'rejected'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reversible only when nothing is using the new value: dropping straight
    // back to the three-value constraint would otherwise leave an existing
    // `provisional` row violating the restored CHECK.
    await queryRunner.query(`
      ALTER TABLE "leadflow_telemetry_consent_notices"
        DROP CONSTRAINT "CK_lf_telemetry_notice_legal_review"
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_telemetry_consent_notices"
        ADD CONSTRAINT "CK_lf_telemetry_notice_legal_review"
        CHECK ("legal_review_status" IN ('pending', 'approved', 'rejected'))
    `);
  }
}
