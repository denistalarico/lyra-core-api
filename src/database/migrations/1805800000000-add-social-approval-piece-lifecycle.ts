import type { MigrationInterface, QueryRunner } from 'typeorm';

const EVENT_TYPES = `'sent','internal_skipped','viewed','commented','approved','changes_requested','agency_override','edited','superseded','cancelled','finished','reopened_stale','withdrawn'`;

/**
 * Lifecycle of a card after it leaves the work: archived (greyed out, still
 * on the board) and deleted (off the board for good). Both are marks on the
 * piece only: requests, decisions and the Planner item are never touched.
 * `deleted_at` is a tombstone, not a DELETE, because the board sync (D-31)
 * would recreate a Planner piece whose row disappeared.
 */
export class AddSocialApprovalPieceLifecycle1805800000000 implements MigrationInterface {
  name = 'AddSocialApprovalPieceLifecycle1805800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "social_approval_pieces"
      ADD COLUMN IF NOT EXISTS "archived_at" timestamptz,
      ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz`);
    await queryRunner.query(`ALTER TABLE "social_approval_board_preferences"
      ADD COLUMN IF NOT EXISTS "auto_delete_finished" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(
      `ALTER TABLE "social_approval_events" DROP CONSTRAINT IF EXISTS "CK_social_approval_events_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_events" ADD CONSTRAINT "CK_social_approval_events_type" CHECK ("type" IN (${EVENT_TYPES},'archived','unarchived','deleted'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_approval_events" DROP CONSTRAINT IF EXISTS "CK_social_approval_events_type"`,
    );
    // NOT VALID: the trail is append-only, so lifecycle rows cannot be removed.
    await queryRunner.query(
      `ALTER TABLE "social_approval_events" ADD CONSTRAINT "CK_social_approval_events_type" CHECK ("type" IN (${EVENT_TYPES})) NOT VALID`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_board_preferences" DROP COLUMN IF EXISTS "auto_delete_finished"`,
    );
    await queryRunner.query(`ALTER TABLE "social_approval_pieces"
      DROP COLUMN IF EXISTS "archived_at",
      DROP COLUMN IF EXISTS "deleted_at"`);
  }
}
