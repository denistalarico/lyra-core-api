import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SEC-A1 — authorship display snapshot for Knowledge content.
 *
 * The real author is always `author_id` (the authenticated user). These
 * columns only record how that authorship was *shown* when the content was
 * published, so a later rename or job change does not rewrite history:
 *
 * - `author_display_mode`: `name_and_role` | `role_only` (the author's choice);
 * - `author_display_value`: the text the backend composed from the author's
 *   membership name and Team job title at that moment. Never browser input.
 *
 * No backfill: existing rows keep `author_display_value` NULL and the UI falls
 * back to what it showed before. Inventing a past snapshot from today's
 * identity would be exactly the kind of rewritten history this prevents.
 *
 * Idempotent (`IF [NOT] EXISTS`) so the PostgreSQL specs can run `up()` on an
 * already-migrated test database.
 */
const TABLES = [
  'agency_knowledge_articles',
  'agency_knowledge_comments',
  'agency_knowledge_quick_notes',
] as const;

export class AddKnowledgeAuthorDisplay1799100000000 implements MigrationInterface {
  name = 'AddKnowledgeAuthorDisplay1799100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Schema drift fix: the entity has always mapped `author_name` on comments
    // and production has the column, but no migration ever created it, so a
    // freshly migrated database failed every comment insert. No-op where it
    // exists; kept by `down()` because it predates this migration.
    await queryRunner.query(`
      ALTER TABLE "agency_knowledge_comments"
        ADD COLUMN IF NOT EXISTS "author_name" varchar(180)
    `);

    for (const table of TABLES) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ADD COLUMN IF NOT EXISTS "author_display_mode" varchar(20) NOT NULL DEFAULT 'name_and_role',
          ADD COLUMN IF NOT EXISTS "author_display_value" varchar(300)
      `);
      await queryRunner.query(`
        ALTER TABLE "${table}"
          DROP CONSTRAINT IF EXISTS "CK_${table}_author_display_mode"
      `);
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "CK_${table}_author_display_mode"
          CHECK ("author_display_mode" IN ('name_and_role', 'role_only'))
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
          DROP CONSTRAINT IF EXISTS "CK_${table}_author_display_mode",
          DROP COLUMN IF EXISTS "author_display_value",
          DROP COLUMN IF EXISTS "author_display_mode"
      `);
    }
  }
}
