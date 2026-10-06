import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CS3.4.2 — the reference images a generation SENDS, frozen at enqueue.
 *
 *   social_creative_generation_references   generation → ordered references
 *
 * `generation_context` (CS3.4.1) records what was AVAILABLE (counts and
 * digests per owner). This table records what was SELECTED, one row per
 * image in the order the provider receives them, with a snapshot of the
 * binary's identity (mime, size, sha256). The worker dispatches these rows
 * and nothing else.
 *
 * `dispatch_started_at` is the first time a worker, holding a valid lease and
 * with every reference verified, STARTED a dispatch attempt to the provider.
 * It is written BEFORE the call, so it does not prove the provider received,
 * processed, billed or answered anything — the process may die between this
 * write and the request leaving. Write-once, under the lease; retries keep the
 * first value.
 *
 * WHY NO FOREIGN KEY TO THE BINARY
 * --------------------------------
 * Two owners: Brand Kit assets live in `brand_kit_assets` (own storage, own
 * delete flow), Planner/operator images in `media_assets`. Provenance must
 * outlive both — a Brand Kit delete, a future CS3.6 expiry — so the owner id
 * is kept as plain identity, with the checksum proving which bytes were used.
 * An FK would either block those deletes forever (RESTRICT) or erase the
 * provenance (SET NULL). Integrity comes from triggers instead:
 *
 *   - `TR_social_creative_generation_references_validate` (BEFORE INSERT):
 *     the generation is a fresh `queued` row (references are only written at
 *     enqueue); the owner row exists in the generation's exact four-part
 *     scope (IS DISTINCT FROM, so agency NULLs compare right), is durable and
 *     not deleted, and matches the mime/size/checksum snapshot; a `planner`
 *     media is a current reference of the generation's content item;
 *   - `TR_social_creative_generation_references_frozen` (BEFORE UPDATE OR
 *     DELETE): rows never change except `dispatch_started_at` NULL → time,
 *     and are never
 *     deleted — later Planner/Brand Kit edits cannot rewrite a generation;
 *   - `TR_media_assets_generation_reference_guard` (AFTER UPDATE) and
 *     `TR_media_assets_generation_reference_delete_guard` (BEFORE DELETE):
 *     while the generation is pending (queued/processing), its media cannot
 *     be re-scoped, tombstoned, made temporary, re-typed, re-keyed, have its
 *     checksum changed or be deleted. Once terminal it is free again — the
 *     row keeps the provenance.
 *
 * Brand Kit gets no such guard on purpose: its delete is an explicit owner
 * action (possibly a privacy request) and must not wait on background work.
 * A generation whose Brand Kit image disappears before the worker reads it
 * fails with `reference_unavailable` — never substituted.
 *
 * At most 6 references (`position` 0..5) — the technical limit of CS3.4.2.
 *
 * Every statement is re-runnable (specs call `up()` against migrated schemas).
 */
export class CreateSocialCreativeGenerationReferences1798300000000 implements MigrationInterface {
  name = 'CreateSocialCreativeGenerationReferences1798300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_creative_generation_references" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "generation_id" uuid NOT NULL,
        "position" smallint NOT NULL,
        "source" varchar(16) NOT NULL,
        "kind" varchar(40) NOT NULL,
        "role" varchar(16) NOT NULL,
        "brand_kit_asset_id" uuid,
        "media_asset_id" uuid,
        "mime_type" varchar(32) NOT NULL,
        "byte_size" bigint NOT NULL,
        "checksum" char(64) NOT NULL,
        "dispatch_started_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_creative_generation_references" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "social_creative_generation_references"
        DROP CONSTRAINT IF EXISTS "FK_social_creative_generation_references_generation",
        DROP CONSTRAINT IF EXISTS "UQ_social_creative_generation_references_position",
        DROP CONSTRAINT IF EXISTS "UQ_social_creative_generation_references_media",
        DROP CONSTRAINT IF EXISTS "UQ_social_creative_generation_references_brand",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generation_references_position",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generation_references_owner",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generation_references_vocabulary",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generation_references_binary",
        ADD CONSTRAINT "FK_social_creative_generation_references_generation"
          FOREIGN KEY ("generation_id")
          REFERENCES "social_creative_generations" ("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "UQ_social_creative_generation_references_position"
          UNIQUE ("generation_id", "position"),
        ADD CONSTRAINT "UQ_social_creative_generation_references_media"
          UNIQUE ("generation_id", "media_asset_id"),
        ADD CONSTRAINT "UQ_social_creative_generation_references_brand"
          UNIQUE ("generation_id", "brand_kit_asset_id"),
        ADD CONSTRAINT "CK_social_creative_generation_references_position"
          CHECK ("position" BETWEEN 0 AND 5),
        ADD CONSTRAINT "CK_social_creative_generation_references_owner"
          CHECK (
            ("source" = 'brand') = ("brand_kit_asset_id" IS NOT NULL)
            AND ("source" <> 'brand') = ("media_asset_id" IS NOT NULL)
          ),
        ADD CONSTRAINT "CK_social_creative_generation_references_vocabulary"
          CHECK (
            "source" IN ('brand', 'planner', 'operator')
            AND "kind" ~ '^[a-z][a-z0-9_]{1,39}$'
            AND "role" IN ('subject', 'logo', 'context', 'style', 'general')
          ),
        ADD CONSTRAINT "CK_social_creative_generation_references_binary"
          CHECK (
            "mime_type" IN ('image/png', 'image/jpeg', 'image/webp')
            AND "byte_size" > 0
            AND "checksum" ~ '^[0-9a-f]{64}$'
          )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_generation_references_media"
        ON "social_creative_generation_references" ("media_asset_id")
        WHERE "media_asset_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_generation_references_brand"
        ON "social_creative_generation_references" ("brand_kit_asset_id")
        WHERE "brand_kit_asset_id" IS NOT NULL
    `);

    // A new failure code the domain raises before any provider call.
    await queryRunner.query(`
      ALTER TABLE "social_creative_generations"
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_error",
        ADD CONSTRAINT "CK_social_creative_generations_error"
          CHECK (
            "error_code" IS NULL OR "error_code" IN (
              'unavailable', 'rejected', 'rate_limited', 'timeout', 'failed',
              'invalid_output', 'reference_unavailable'
            )
          )
    `);

    // ── The row itself ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_creative_generation_reference()
      RETURNS trigger AS $$
      DECLARE generation record;
      DECLARE media "media_assets"%ROWTYPE;
      DECLARE brand record;
      BEGIN
        SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id",
               "status", "attempts", "content_item_id"
          INTO generation
          FROM "social_creative_generations" WHERE "id" = NEW."generation_id";
        IF NOT FOUND OR generation."status" <> 'queued' OR generation."attempts" <> 0 THEN
          RAISE EXCEPTION 'generation references are frozen at enqueue'
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

        SELECT * INTO media FROM "media_assets" WHERE "id" = NEW."media_asset_id";
        IF NOT FOUND OR
           media."tenant_id" IS DISTINCT FROM generation."tenant_id" OR
           media."workspace_id" IS DISTINCT FROM generation."workspace_id" OR
           media."agency_client_id" IS DISTINCT FROM generation."agency_client_id" OR
           media."company_context_id" IS DISTINCT FROM generation."company_context_id" OR
           media."deleted_at" IS NOT NULL OR
           media."source" LIKE 'temporary:%' OR
           media."mime_type" IS DISTINCT FROM NEW."mime_type" OR
           media."byte_size" IS DISTINCT FROM NEW."byte_size" OR
           media."checksum" IS DISTINCT FROM NEW."checksum" THEN
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
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_generation_references_validate" ON "social_creative_generation_references"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_creative_generation_references_validate"
      BEFORE INSERT ON "social_creative_generation_references"
      FOR EACH ROW EXECUTE FUNCTION validate_social_creative_generation_reference()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION freeze_social_creative_generation_reference()
      RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'DELETE' THEN
          RAISE EXCEPTION 'generation references are provenance and cannot be deleted'
            USING ERRCODE = '23514';
        END IF;
        IF (to_jsonb(NEW) - 'dispatch_started_at') IS DISTINCT FROM (to_jsonb(OLD) - 'dispatch_started_at') OR
           (OLD."dispatch_started_at" IS NOT NULL AND NEW."dispatch_started_at" IS DISTINCT FROM OLD."dispatch_started_at") THEN
          RAISE EXCEPTION 'generation references are frozen at enqueue'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_generation_references_frozen" ON "social_creative_generation_references"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_creative_generation_references_frozen"
      BEFORE UPDATE OR DELETE ON "social_creative_generation_references"
      FOR EACH ROW EXECUTE FUNCTION freeze_social_creative_generation_reference()
    `);

    // ── Pending generations hold their media ──────────────────────────────
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
               NEW."source" LIKE 'temporary:%' OR
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
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION guard_social_creative_generation_reference_media_delete()
      RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM "social_creative_generation_references" ref
            JOIN "social_creative_generations" generation
              ON generation."id" = ref."generation_id"
           WHERE ref."media_asset_id" = OLD."id"
             AND generation."status" IN ('queued', 'processing')
        ) THEN
          RAISE EXCEPTION 'media is a reference of a pending generation'
            USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_media_assets_generation_reference_guard" ON "media_assets"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_media_assets_generation_reference_guard"
      AFTER UPDATE OF
        "tenant_id", "workspace_id", "agency_client_id", "company_context_id",
        "source", "mime_type", "storage_path", "checksum", "deleted_at"
      ON "media_assets"
      FOR EACH ROW EXECUTE FUNCTION guard_social_creative_generation_reference_media()
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_media_assets_generation_reference_delete_guard" ON "media_assets"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_media_assets_generation_reference_delete_guard"
      BEFORE DELETE ON "media_assets"
      FOR EACH ROW EXECUTE FUNCTION guard_social_creative_generation_reference_media_delete()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const trigger of [
      'TR_media_assets_generation_reference_delete_guard',
      'TR_media_assets_generation_reference_guard',
    ])
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS "${trigger}" ON "media_assets"`,
      );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_creative_generation_references"',
    );
    for (const fn of [
      'guard_social_creative_generation_reference_media_delete',
      'guard_social_creative_generation_reference_media',
      'freeze_social_creative_generation_reference',
      'validate_social_creative_generation_reference',
    ])
      await queryRunner.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    // A row may hold the new code; it reverts to the generic one.
    await queryRunner.query(`
      UPDATE "social_creative_generations"
         SET "error_code" = 'failed'
       WHERE "error_code" = 'reference_unavailable'
    `);
    await queryRunner.query(`
      ALTER TABLE "social_creative_generations"
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_error",
        ADD CONSTRAINT "CK_social_creative_generations_error"
          CHECK (
            "error_code" IS NULL OR "error_code" IN (
              'unavailable', 'rejected', 'rate_limited', 'timeout', 'failed', 'invalid_output'
            )
          )
    `);
  }
}
