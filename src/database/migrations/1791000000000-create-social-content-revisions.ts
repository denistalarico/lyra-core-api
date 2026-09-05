import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Social Planner editorial revisions and provenance.
 *
 * Adds the current textual state to social_content_items and creates an
 * append-oriented revision history. No provider or Intelligence implementation
 * is introduced here; generation_run_id is deliberately only a reference.
 */
export class CreateSocialContentRevisions1791000000000
  implements MigrationInterface
{
  name = 'CreateSocialContentRevisions1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        ADD COLUMN IF NOT EXISTS "copy" text,
        ADD COLUMN IF NOT EXISTS "caption" text,
        ADD COLUMN IF NOT EXISTS "script" text,
        ADD COLUMN IF NOT EXISTS "cta" text,
        ADD COLUMN IF NOT EXISTS "hashtags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS "first_comment" text,
        ADD COLUMN IF NOT EXISTS "current_revision_id" uuid
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'CK_social_content_items_hashtags_array'
        ) THEN
          ALTER TABLE "social_content_items"
            ADD CONSTRAINT "CK_social_content_items_hashtags_array"
            CHECK (jsonb_typeof("hashtags") = 'array');
        END IF;
      END
      $$
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_content_revisions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),

        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        "content_item_id" uuid NOT NULL,
        "revision_number" integer NOT NULL,

        "copy" text,
        "caption" text,
        "script" text,
        "cta" text,
        "hashtags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "first_comment" text,

        "brief_snapshot" text,

        "source" varchar(32) NOT NULL DEFAULT 'human',
        "parent_revision_id" uuid,
        "generation_run_id" uuid,
        "created_by_id" uuid,

        "created_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_content_revisions"
          PRIMARY KEY ("id"),

        CONSTRAINT "FK_social_content_revisions_content"
          FOREIGN KEY ("content_item_id")
          REFERENCES "social_content_items" ("id")
          ON DELETE CASCADE,

        CONSTRAINT "FK_social_content_revisions_parent"
          FOREIGN KEY ("parent_revision_id")
          REFERENCES "social_content_revisions" ("id")
          ON DELETE SET NULL,

        CONSTRAINT "CK_social_content_revisions_number"
          CHECK ("revision_number" > 0),

        CONSTRAINT "CK_social_content_revisions_source"
          CHECK (
            "source" IN (
              'human',
              'ai',
              'ai_then_human',
              'human_then_ai',
              'restored',
              'import'
            )
          ),

        CONSTRAINT "CK_social_content_revisions_hashtags_array"
          CHECK (jsonb_typeof("hashtags") = 'array')
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_content_revisions_number"
        ON "social_content_revisions" (
          "content_item_id",
          "revision_number"
        )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_content_revisions_scope"
        ON "social_content_revisions" (
          "tenant_id",
          "workspace_id",
          "agency_client_id"
        )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_content_revisions_content"
        ON "social_content_revisions" (
          "content_item_id",
          "revision_number"
        )
    `);

    /**
     * Added only after the revisions table exists so there is no circular
     * creation dependency.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_social_content_items_current_revision'
        ) THEN
          ALTER TABLE "social_content_items"
            ADD CONSTRAINT "FK_social_content_items_current_revision"
            FOREIGN KEY ("current_revision_id")
            REFERENCES "social_content_revisions" ("id")
            ON DELETE SET NULL;
        END IF;
      END
      $$
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS
        "IDX_social_content_items_current_revision"
        ON "social_content_items" ("current_revision_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_content_items_current_revision"',
    );

    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        DROP CONSTRAINT IF EXISTS "FK_social_content_items_current_revision"
    `);

    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_content_revisions_content"',
    );

    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_content_revisions_scope"',
    );

    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_content_revisions_number"',
    );

    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_content_revisions"',
    );

    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        DROP CONSTRAINT IF EXISTS "CK_social_content_items_hashtags_array"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        DROP COLUMN IF EXISTS "current_revision_id",
        DROP COLUMN IF EXISTS "first_comment",
        DROP COLUMN IF EXISTS "hashtags",
        DROP COLUMN IF EXISTS "cta",
        DROP COLUMN IF EXISTS "script",
        DROP COLUMN IF EXISTS "caption",
        DROP COLUMN IF EXISTS "copy"
    `);
  }
}
