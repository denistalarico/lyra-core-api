import type { MigrationInterface, QueryRunner } from 'typeorm';
import { CreateSocialCreativeGenerationReferences1798300000000 } from './1798300000000-create-social-creative-generation-references';

/**
 * CS3.6.2 — Regeneration & Variations: where a generation CAME FROM.
 *
 *   Generation
 *      ├── regenerate → Generation          origin_generation_id
 *      └── Output → variation → Generation  origin_output_id
 *   Creative Version
 *      └── variation → Generation           origin_version_id
 *
 * WHY COLUMNS (AND NOT A TABLE OR JSON)
 * -------------------------------------
 * A generation has at most one creative origin, and each origin is an
 * internal entity that is never deleted (generations and outputs are
 * provenance; versions are immutable, assets are only archived). So three
 * nullable FKs (`ON DELETE RESTRICT`) plus `origin_type` say it exactly, and
 * the database can check it: one CHECK makes "exactly one origin, of the
 * declared type" true, and a trigger holds the origin to the generation's
 * four-part scope. `generation_context` stays what it was — digests of the
 * context, not identity.
 *
 * THE BASE IMAGE IS A REFERENCE ROW
 * ---------------------------------
 * A variation's base travels like any other reference: frozen at enqueue in
 * `social_creative_generation_references` (position 0 = "Image 1", source /
 * kind / role `base`), with the mime/size/sha256 snapshot that proves which
 * bytes were sent. Reusing the row means reusing everything CS3.4.2 and
 * CS3.6.1 already enforce for a referenced media while its generation is
 * pending — the guard triggers on `media_assets` and the cleanup's owner
 * check. A base that is a TEMPORARY output is the one exception to "durable
 * only", and only for the exact media of the origin:
 *
 *   - variation of an output  → that output's temporary media;
 *   - variation of a version  → that version's durable media;
 *   - regeneration of a
 *     variation               → the origin's own base, same checksum.
 *
 * A deferred constraint trigger requires the base at commit, so a variation
 * without its Image 1 cannot exist even if a caller forgets to insert it.
 * The base counts toward the six references (`position` 0..5 unchanged).
 *
 * CLEANUP RACE
 * ------------
 * The reference trigger now reads the media row `FOR SHARE`. The cleanup
 * claims with `FOR UPDATE SKIP LOCKED`, so either the enqueue locks first
 * (the sweep skips the row; the next sweep sees the committed pending
 * reference) or the sweep tombstones first (the enqueue waits, re-reads the
 * row, sees `deleted_at` and refuses). Without the lock a concurrent sweep
 * could tombstone a base that an uncommitted variation had just validated.
 *
 * `down()` restores the CS3.4.2 functions and vocabulary through that
 * migration's own (re-runnable) `up()`. It refuses once a `base` reference
 * exists: the CHECK cannot be narrowed without deleting provenance.
 *
 * Every statement is re-runnable (specs call `up()` against migrated schemas).
 */
export class AddSocialCreativeGenerationDerivation1798500000000 implements MigrationInterface {
  name = 'AddSocialCreativeGenerationDerivation1798500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_creative_generations"
        ADD COLUMN IF NOT EXISTS "origin_type" varchar(16) NOT NULL DEFAULT 'fresh',
        ADD COLUMN IF NOT EXISTS "origin_generation_id" uuid,
        ADD COLUMN IF NOT EXISTS "origin_output_id" uuid,
        ADD COLUMN IF NOT EXISTS "origin_version_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "social_creative_generations"
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_origin",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_generations_origin_generation",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_generations_origin_output",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_generations_origin_version",
        ADD CONSTRAINT "CK_social_creative_generations_origin"
          CHECK (
            ("origin_type" = 'fresh'
              AND "origin_generation_id" IS NULL
              AND "origin_output_id" IS NULL
              AND "origin_version_id" IS NULL)
            OR ("origin_type" = 'regeneration'
              AND "origin_generation_id" IS NOT NULL
              AND "origin_output_id" IS NULL
              AND "origin_version_id" IS NULL)
            OR ("origin_type" = 'variation'
              AND "origin_generation_id" IS NULL
              AND ("origin_output_id" IS NULL) <> ("origin_version_id" IS NULL))
          ),
        ADD CONSTRAINT "FK_social_creative_generations_origin_generation"
          FOREIGN KEY ("origin_generation_id")
          REFERENCES "social_creative_generations" ("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_social_creative_generations_origin_output"
          FOREIGN KEY ("origin_output_id")
          REFERENCES "social_creative_generation_outputs" ("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_social_creative_generations_origin_version"
          FOREIGN KEY ("origin_version_id")
          REFERENCES "social_creative_asset_versions" ("id") ON DELETE RESTRICT
    `);
    for (const column of [
      'origin_generation_id',
      'origin_output_id',
      'origin_version_id',
    ])
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_social_creative_generations_${column}"
          ON "social_creative_generations" ("${column}")
          WHERE "${column}" IS NOT NULL
      `);

    // ── The origin: same scope, finished, immutable ──────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_creative_generation_origin()
      RETURNS trigger AS $$
      DECLARE origin record;
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          IF NEW."origin_type" IS DISTINCT FROM OLD."origin_type" OR
             NEW."origin_generation_id" IS DISTINCT FROM OLD."origin_generation_id" OR
             NEW."origin_output_id" IS DISTINCT FROM OLD."origin_output_id" OR
             NEW."origin_version_id" IS DISTINCT FROM OLD."origin_version_id" THEN
            RAISE EXCEPTION 'generation origin is immutable'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END IF;

        IF NEW."origin_generation_id" IS NOT NULL THEN
          SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "status"
            INTO origin
            FROM "social_creative_generations" WHERE "id" = NEW."origin_generation_id";
        ELSIF NEW."origin_output_id" IS NOT NULL THEN
          SELECT generation."tenant_id", generation."workspace_id",
                 generation."agency_client_id", generation."company_context_id",
                 generation."status"
            INTO origin
            FROM "social_creative_generation_outputs" output
            JOIN "social_creative_generations" generation
              ON generation."id" = output."generation_id"
           WHERE output."id" = NEW."origin_output_id";
        ELSIF NEW."origin_version_id" IS NOT NULL THEN
          SELECT asset."tenant_id", asset."workspace_id",
                 asset."agency_client_id", asset."company_context_id",
                 'completed'::varchar AS "status"
            INTO origin
            FROM "social_creative_asset_versions" version
            JOIN "social_creative_assets" asset
              ON asset."id" = version."creative_asset_id"
           WHERE version."id" = NEW."origin_version_id";
        ELSE
          RETURN NEW;
        END IF;

        IF NOT FOUND OR
           origin."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
           origin."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
           origin."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
           origin."company_context_id" IS DISTINCT FROM NEW."company_context_id" OR
           origin."status" NOT IN ('completed', 'failed') THEN
          RAISE EXCEPTION 'generation origin must be a finished entity of the generation scope'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_generations_origin" ON "social_creative_generations"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_creative_generations_origin"
      BEFORE INSERT OR UPDATE OF
        "origin_type", "origin_generation_id", "origin_output_id", "origin_version_id"
      ON "social_creative_generations"
      FOR EACH ROW EXECUTE FUNCTION validate_social_creative_generation_origin()
    `);

    // ── A derived generation that needs a base has it, at commit ─────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION require_social_creative_generation_base()
      RETURNS trigger AS $$
      BEGIN
        IF (NEW."origin_type" = 'variation' OR EXISTS (
              SELECT 1 FROM "social_creative_generation_references"
               WHERE "generation_id" = NEW."origin_generation_id"
                 AND "source" = 'base'
            )) AND NOT EXISTS (
              SELECT 1 FROM "social_creative_generation_references"
               WHERE "generation_id" = NEW."id" AND "source" = 'base'
            ) THEN
          RAISE EXCEPTION 'a variation must freeze its base image'
            USING ERRCODE = '23514';
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_generations_base_required" ON "social_creative_generations"',
    );
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER "TR_social_creative_generations_base_required"
      AFTER INSERT ON "social_creative_generations"
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW
      WHEN (NEW."origin_type" <> 'fresh')
      EXECUTE FUNCTION require_social_creative_generation_base()
    `);

    // ── References: `base` vocabulary ────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "social_creative_generation_references"
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generation_references_vocabulary",
        ADD CONSTRAINT "CK_social_creative_generation_references_vocabulary"
          CHECK (
            "source" IN ('brand', 'planner', 'operator', 'base')
            AND "kind" ~ '^[a-z][a-z0-9_]{1,39}$'
            AND "role" IN ('subject', 'logo', 'context', 'style', 'general', 'base')
          )
    `);

    // Same as CS3.4.2 for brand/planner/operator; adds the base rules and
    // reads the media row FOR SHARE (see CLEANUP RACE above).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_creative_generation_reference()
      RETURNS trigger AS $$
      DECLARE generation record;
      DECLARE media "media_assets"%ROWTYPE;
      DECLARE brand record;
      DECLARE base_media_id uuid;
      BEGIN
        SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id",
               "status", "attempts", "content_item_id",
               "origin_generation_id", "origin_output_id", "origin_version_id"
          INTO generation
          FROM "social_creative_generations" WHERE "id" = NEW."generation_id";
        IF NOT FOUND OR generation."status" <> 'queued' OR generation."attempts" <> 0 THEN
          RAISE EXCEPTION 'generation references are frozen at enqueue'
            USING ERRCODE = '23514';
        END IF;

        IF (NEW."source" = 'base') <> (NEW."role" = 'base') OR
           (NEW."source" = 'base') <> (NEW."kind" = 'base') OR
           (NEW."source" = 'base' AND NEW."position" <> 0) THEN
          RAISE EXCEPTION 'only the base image is Image 1 with the base role'
            USING ERRCODE = '23514';
        END IF;

        IF NEW."source" = 'brand' THEN
          SELECT asset."tenant_id", asset."workspace_id", asset."agency_client_id",
                 kit."company_context_id", asset."mime_type", asset."byte_size",
                 asset."checksum", asset."deleted_at", asset."kind"
            INTO brand
            FROM "brand_kit_assets" asset
            JOIN "brand_kits" kit ON kit."id" = asset."brand_kit_id"
           WHERE asset."id" = NEW."brand_kit_asset_id";
          IF NOT FOUND OR
             brand."tenant_id" IS DISTINCT FROM generation."tenant_id" OR
             brand."workspace_id" IS DISTINCT FROM generation."workspace_id" OR
             brand."agency_client_id" IS DISTINCT FROM generation."agency_client_id" OR
             brand."company_context_id" IS DISTINCT FROM generation."company_context_id" OR
             brand."deleted_at" IS NOT NULL OR
             brand."kind" IS DISTINCT FROM NEW."kind" OR
             brand."mime_type" IS DISTINCT FROM NEW."mime_type" OR
             brand."byte_size" IS DISTINCT FROM NEW."byte_size" OR
             brand."checksum" IS DISTINCT FROM NEW."checksum" THEN
            RAISE EXCEPTION 'generation reference must be a Brand Kit asset of the generation scope'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END IF;

        SELECT * INTO media FROM "media_assets" WHERE "id" = NEW."media_asset_id" FOR SHARE;
        IF NOT FOUND OR
           media."tenant_id" IS DISTINCT FROM generation."tenant_id" OR
           media."workspace_id" IS DISTINCT FROM generation."workspace_id" OR
           media."agency_client_id" IS DISTINCT FROM generation."agency_client_id" OR
           media."company_context_id" IS DISTINCT FROM generation."company_context_id" OR
           media."deleted_at" IS NOT NULL OR
           media."mime_type" IS DISTINCT FROM NEW."mime_type" OR
           media."byte_size" IS DISTINCT FROM NEW."byte_size" OR
           media."checksum" IS DISTINCT FROM NEW."checksum" THEN
          RAISE EXCEPTION 'generation reference must be a durable image of the generation scope'
            USING ERRCODE = '23514';
        END IF;

        IF NEW."source" = 'base' THEN
          IF generation."origin_output_id" IS NOT NULL THEN
            SELECT "media_asset_id" INTO base_media_id
              FROM "social_creative_generation_outputs"
             WHERE "id" = generation."origin_output_id";
          ELSIF generation."origin_version_id" IS NOT NULL THEN
            SELECT "media_asset_id" INTO base_media_id
              FROM "social_creative_asset_versions"
             WHERE "id" = generation."origin_version_id";
          ELSIF generation."origin_generation_id" IS NOT NULL THEN
            SELECT "media_asset_id" INTO base_media_id
              FROM "social_creative_generation_references"
             WHERE "generation_id" = generation."origin_generation_id"
               AND "source" = 'base'
               AND "checksum" = NEW."checksum";
          END IF;
          IF base_media_id IS NULL OR base_media_id <> NEW."media_asset_id" OR
             (media."source" LIKE 'temporary:%' AND media."source" <> 'temporary:creative_generation') THEN
            RAISE EXCEPTION 'the base must be the exact image of the generation origin'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END IF;

        IF media."source" LIKE 'temporary:%' THEN
          RAISE EXCEPTION 'generation reference must be a durable image of the generation scope'
            USING ERRCODE = '23514';
        END IF;

        IF NEW."source" = 'planner' AND NOT EXISTS (
             SELECT 1 FROM "social_content_references" ref
              WHERE ref."content_item_id" = generation."content_item_id"
                AND ref."media_asset_id" = NEW."media_asset_id"
                AND ref."kind" = NEW."kind"
           ) THEN
          RAISE EXCEPTION 'planner generation reference must be a reference of the generation content item'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    // A pending generation's media keeps its source: a temporary base is
    // already temporary, so "made temporary" became "re-sourced at all".
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION guard_social_creative_generation_reference_media()
      RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM "social_creative_generation_references" ref
            JOIN "social_creative_generations" generation
              ON generation."id" = ref."generation_id"
           WHERE ref."media_asset_id" = OLD."id"
             AND generation."status" IN ('queued', 'processing')
             AND (
               NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id" OR
               NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id" OR
               NEW."agency_client_id" IS DISTINCT FROM OLD."agency_client_id" OR
               NEW."company_context_id" IS DISTINCT FROM OLD."company_context_id" OR
               NEW."deleted_at" IS NOT NULL OR
               NEW."source" IS DISTINCT FROM OLD."source" OR
               NEW."mime_type" IS DISTINCT FROM OLD."mime_type" OR
               NEW."storage_path" IS DISTINCT FROM OLD."storage_path" OR
               NEW."checksum" IS DISTINCT FROM OLD."checksum"
             )
        ) THEN
          RAISE EXCEPTION 'media is a reference of a pending generation'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_generations_base_required" ON "social_creative_generations"',
    );
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_generations_origin" ON "social_creative_generations"',
    );
    for (const fn of [
      'require_social_creative_generation_base',
      'validate_social_creative_generation_origin',
    ])
      await queryRunner.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    await queryRunner.query(`
      ALTER TABLE "social_creative_generations"
        DROP COLUMN IF EXISTS "origin_version_id",
        DROP COLUMN IF EXISTS "origin_output_id",
        DROP COLUMN IF EXISTS "origin_generation_id",
        DROP COLUMN IF EXISTS "origin_type"
    `);
    // CS3.4.2's functions, triggers and vocabulary, exactly as it defines
    // them. Fails on purpose while a `base` reference exists.
    await new CreateSocialCreativeGenerationReferences1798300000000().up(
      queryRunner,
    );
  }
}
