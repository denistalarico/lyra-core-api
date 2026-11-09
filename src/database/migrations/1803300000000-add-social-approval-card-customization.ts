import type { MigrationInterface, QueryRunner } from 'typeorm';

const EVENT_TYPES = `'sent','internal_skipped','viewed','commented','approved','changes_requested','agency_override','edited','superseded','cancelled','finished','reopened_stale'`;

/**
 * Card look and tags, the "redo" mark on a request for changes (no new status,
 * D-12) and the `withdrawn` event of a piece removed from the board.
 */
export class AddSocialApprovalCardCustomization1803300000000 implements MigrationInterface {
  name = 'AddSocialApprovalCardCustomization1803300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "social_approval_pieces"
      ADD COLUMN IF NOT EXISTS "card_color" varchar(16) NOT NULL DEFAULT 'none',
      ADD COLUMN IF NOT EXISTS "tags" jsonb NOT NULL DEFAULT '[]',
      ADD COLUMN IF NOT EXISTS "card_display" jsonb NOT NULL DEFAULT '{}'`);
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" ADD COLUMN IF NOT EXISTS "changes_kind" varchar(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" DROP CONSTRAINT IF EXISTS "CK_social_approval_requests_changes_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" ADD CONSTRAINT "CK_social_approval_requests_changes_kind" CHECK ("changes_kind" IS NULL OR "changes_kind" IN ('revise','reject'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_events" DROP CONSTRAINT IF EXISTS "CK_social_approval_events_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_events" ADD CONSTRAINT "CK_social_approval_events_type" CHECK ("type" IN (${EVENT_TYPES},'withdrawn'))`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_approval_events" DROP CONSTRAINT IF EXISTS "CK_social_approval_events_type"`,
    );
    // NOT VALID: the trail is append-only, so `withdrawn` rows cannot be removed.
    await queryRunner.query(
      `ALTER TABLE "social_approval_events" ADD CONSTRAINT "CK_social_approval_events_type" CHECK ("type" IN (${EVENT_TYPES})) NOT VALID`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" DROP CONSTRAINT IF EXISTS "CK_social_approval_requests_changes_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_approval_requests" DROP COLUMN IF EXISTS "changes_kind"`,
    );
    await queryRunner.query(`ALTER TABLE "social_approval_pieces"
      DROP COLUMN IF EXISTS "card_color",
      DROP COLUMN IF EXISTS "tags",
      DROP COLUMN IF EXISTS "card_display"`);
  }
}
