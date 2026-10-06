import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CS3.4.1 — generation context and prompt provenance.
 *
 * A generation now combines the operator's request with server-resolved
 * context (Brand Kit, optionally a Planner content item) into the prompt the
 * provider receives. Three different things must stay distinguishable:
 *
 *   prompt              (existing) what the operator typed — the intent
 *   effective_prompt    the exact text sent to the provider, frozen at enqueue
 *   generation_context  references + digests of the context used: composer and
 *                       context versions, Planner revision, per-section and
 *                       reference-set digests. No copied text.
 *   content_item_id     the Planner item the generation was made for, if any
 *
 * Why the effective prompt is stored and not re-derived: the Brand Kit has no
 * revisions (palette/guidelines are overwritten in place), the Planner only
 * revisions copy/caption/script/CTA (brief, key message, type, format and
 * destinations change in place), and the composer recipe itself evolves. The
 * text is the only faithful record of what was sent.
 *
 * Backfill: before CS3.4.1 the worker sent `prompt` verbatim, so
 * `effective_prompt = prompt` is literally true for existing rows; their
 * `generation_context` stays NULL ("before context resolution").
 *
 * Deploy order: run BEFORE restarting the API (the entity selects the new
 * columns). Old code cannot insert between this and the restart while the
 * provider is `disabled` — enqueue refuses before the INSERT.
 *
 * `content_item_id` follows `social_creative_assets.content_item_id`
 * (FK ON DELETE SET NULL; Planner items are soft-deleted in practice). The
 * context digests and the effective prompt survive the link.
 *
 * Every statement is re-runnable (specs call `up()` against migrated schemas).
 */
export class AddSocialCreativeGenerationContext1798100000000 implements MigrationInterface {
  name = 'AddSocialCreativeGenerationContext1798100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_creative_generations"
        ADD COLUMN IF NOT EXISTS "content_item_id" uuid,
        ADD COLUMN IF NOT EXISTS "effective_prompt" text,
        ADD COLUMN IF NOT EXISTS "generation_context" jsonb
    `);
    await queryRunner.query(`
      UPDATE "social_creative_generations"
         SET "effective_prompt" = "prompt"
       WHERE "effective_prompt" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "social_creative_generations"
        ALTER COLUMN "effective_prompt" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "social_creative_generations"
        DROP CONSTRAINT IF EXISTS "FK_social_creative_generations_content",
        ADD CONSTRAINT "FK_social_creative_generations_content"
          FOREIGN KEY ("content_item_id") REFERENCES "social_content_items" ("id")
          ON DELETE SET NULL,
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_context",
        ADD CONSTRAINT "CK_social_creative_generations_context"
          CHECK (
            char_length("effective_prompt") BETWEEN 1 AND 32000
            AND (
              "generation_context" IS NULL
              OR jsonb_typeof("generation_context") = 'object'
            )
            AND ("content_item_id" IS NULL OR "generation_context" IS NOT NULL)
          )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_generations_content"
        ON "social_creative_generations" ("content_item_id")
        WHERE "content_item_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_creative_generations_content"',
    );
    await queryRunner.query(`
      ALTER TABLE "social_creative_generations"
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_context",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_generations_content",
        DROP COLUMN IF EXISTS "generation_context",
        DROP COLUMN IF EXISTS "effective_prompt",
        DROP COLUMN IF EXISTS "content_item_id"
    `);
  }
}
