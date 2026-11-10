import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Considerations with formatting and reference files. `body` stays the plain
 * text every existing reader uses; the new columns only add to it.
 */
export class AddSocialApprovalCommentRichContent1803500000000 implements MigrationInterface {
  name = 'AddSocialApprovalCommentRichContent1803500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_approval_comments"
        ADD COLUMN IF NOT EXISTS "rich_body" text,
        ADD COLUMN IF NOT EXISTS "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "feedback_id" uuid
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_approval_comments"
        DROP COLUMN IF EXISTS "feedback_id",
        DROP COLUMN IF EXISTS "attachments",
        DROP COLUMN IF EXISTS "rich_body"
    `);
  }
}
