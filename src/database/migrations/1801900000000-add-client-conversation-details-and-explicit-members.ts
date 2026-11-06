import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TC-CL1 — Client conversation details and explicit membership.
 *
 * `title`/`description`/`avatar_url` are optional overrides shown on both
 * surfaces; null falls back to the company name and logo. The participant
 * table becomes the authorization record (no more seat-on-first-touch), and
 * `added_by_user_id` records who seated each member. Existing participant rows
 * are kept as they are: whoever already holds a live seat stays a member.
 */
export class AddClientConversationDetailsAndExplicitMembers1801900000000
  implements MigrationInterface
{
  name = 'AddClientConversationDetailsAndExplicitMembers1801900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "client_conversations"
        ADD COLUMN IF NOT EXISTS "title" varchar(120) NULL,
        ADD COLUMN IF NOT EXISTS "description" varchar(500) NULL,
        ADD COLUMN IF NOT EXISTS "avatar_url" text NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "client_conversation_participants"
        ADD COLUMN IF NOT EXISTS "added_by_user_id" uuid NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "client_conversation_participants"
        DROP COLUMN IF EXISTS "added_by_user_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "client_conversations"
        DROP COLUMN IF EXISTS "avatar_url",
        DROP COLUMN IF EXISTS "description",
        DROP COLUMN IF EXISTS "title"
    `);
  }
}
