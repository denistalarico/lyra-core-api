import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CS3.2 — persisted, asynchronous AI generation for the Creative Studio.
 *
 *   social_creative_generations          one request AND its queue entry
 *   social_creative_generation_outputs   generation → temporary media_asset,
 *                                        and output → promoted version
 *
 * WHY THE ROW IS THE JOB
 * ----------------------
 * The platform has no Redis/Bull; every async workload (Planner copy
 * generation, LeadFlow briefing, S2.5 ad sync, publication runs) is a
 * Postgres table claimed with `FOR UPDATE SKIP LOCKED`. Using the same shape
 * means the record is committed by the same INSERT that enqueues it — there is
 * no "queue has a job the database never saw" and no "record whose enqueue
 * failed" to reconcile, and no outbox is needed.
 *
 * WHY A CHILD TABLE FOR OUTPUTS
 * -----------------------------
 * Outputs need real integrity that JSON cannot give: an FK to the media row
 * that owns the binary (`ON DELETE SET NULL`, so cleanup of a temporary binary
 * keeps the provenance), and a once-only, unique link to the Creative Version
 * a promotion created. That link is the AI provenance
 * (Version ← Output ← Generation) and the promotion idempotency key at once;
 * `social_creative_asset_versions` is not altered.
 *
 * Scope follows CC2C/CS3.1.1: four columns, CHECK that a company implies a
 * client, composite FK to the company's own scope. Outputs inherit the
 * generation's scope; a trigger holds their media and promoted asset to it
 * (the same technique as `TR_social_creative_asset_versions_media_scope`).
 *
 * Every statement is re-runnable (specs call `up()` against migrated schemas).
 */
export class CreateSocialCreativeGenerations1797900000000 implements MigrationInterface {
  name = 'CreateSocialCreativeGenerations1797900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_creative_generations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "company_context_id" uuid,
        "generation_type" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'queued',
        "prompt" text NOT NULL,
        "output_count" smallint NOT NULL,
        "aspect_ratio" varchar(8) NOT NULL,
        "quality" varchar(16) NOT NULL,
        "attempts" smallint NOT NULL DEFAULT 0,
        "max_attempts" smallint NOT NULL,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "locked_at" timestamptz,
        "locked_by" varchar(120),
        "error_code" varchar(40),
        "error_retryable" boolean,
        "provider" varchar(80),
        "model" varchar(120),
        "usage_metrics" jsonb,
        "cost_amount" numeric(18,6),
        "cost_currency" char(3),
        "requested_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "failed_at" timestamptz,
        CONSTRAINT "PK_social_creative_generations" PRIMARY KEY ("id")
      )
    `);

    // Re-runnable: drop-then-add, so a second `up()` converges.
    await queryRunner.query(`
      ALTER TABLE "social_creative_generations"
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_company_scope",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_type",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_status",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_request",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_attempts",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_lifecycle",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_error",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generations_cost",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_generations_company_context",
        ADD CONSTRAINT "CK_social_creative_generations_company_scope"
          CHECK ("company_context_id" IS NULL OR "agency_client_id" IS NOT NULL),
        ADD CONSTRAINT "CK_social_creative_generations_type"
          CHECK ("generation_type" IN ('image')),
        ADD CONSTRAINT "CK_social_creative_generations_status"
          CHECK ("status" IN ('queued', 'processing', 'completed', 'failed')),
        ADD CONSTRAINT "CK_social_creative_generations_request"
          CHECK (
            char_length("prompt") BETWEEN 1 AND 4000
            AND "output_count" BETWEEN 1 AND 4
            AND "aspect_ratio" IN ('1:1', '4:5', '9:16', '16:9')
            AND "quality" IN ('standard', 'high')
          ),
        ADD CONSTRAINT "CK_social_creative_generations_attempts"
          CHECK (
            "max_attempts" >= 1
            AND "attempts" >= 0
            AND "attempts" <= "max_attempts"
          ),
        ADD CONSTRAINT "CK_social_creative_generations_lifecycle"
          CHECK (
            ("status" = 'processing') = ("locked_by" IS NOT NULL AND "locked_at" IS NOT NULL)
            AND ("status" <> 'completed' OR ("completed_at" IS NOT NULL AND "error_code" IS NULL))
            AND ("status" <> 'failed' OR ("failed_at" IS NOT NULL AND "error_code" IS NOT NULL))
          ),
        ADD CONSTRAINT "CK_social_creative_generations_error"
          CHECK (
            "error_code" IS NULL OR "error_code" IN (
              'unavailable', 'rejected', 'rate_limited', 'timeout', 'failed', 'invalid_output'
            )
          ),
        ADD CONSTRAINT "CK_social_creative_generations_cost"
          CHECK (
            ("cost_amount" IS NULL) = ("cost_currency" IS NULL)
            AND ("cost_amount" IS NULL OR "cost_amount" >= 0)
          ),
        ADD CONSTRAINT "FK_social_creative_generations_company_context"
          FOREIGN KEY (
            "company_context_id", "tenant_id", "workspace_id", "agency_client_id"
          )
          REFERENCES "agency_client_company_contexts" (
            "id", "tenant_id", "workspace_id", "agency_client_id"
          )
          ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_generations_scope"
        ON "social_creative_generations" (
          "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "created_at"
        )
    `);
    // The claim loop reads only these two slices; partial indexes stay small
    // however much history accumulates.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_generations_queued"
        ON "social_creative_generations" ("available_at", "id")
        WHERE "status" = 'queued'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_generations_processing"
        ON "social_creative_generations" ("tenant_id", "locked_at")
        WHERE "status" = 'processing'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_creative_generation_outputs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "generation_id" uuid NOT NULL,
        "output_index" smallint NOT NULL,
        "media_asset_id" uuid,
        "promotion_kind" varchar(16),
        "promoted_creative_asset_id" uuid,
        "promoted_version_id" uuid,
        "promoted_by_id" uuid,
        "promoted_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_creative_generation_outputs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "social_creative_generation_outputs"
        DROP CONSTRAINT IF EXISTS "UQ_social_creative_generation_outputs_index",
        DROP CONSTRAINT IF EXISTS "UQ_social_creative_generation_outputs_media",
        DROP CONSTRAINT IF EXISTS "UQ_social_creative_generation_outputs_version",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generation_outputs_index",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_generation_outputs_promotion",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_generation_outputs_generation",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_generation_outputs_media",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_generation_outputs_asset",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_generation_outputs_version",
        ADD CONSTRAINT "UQ_social_creative_generation_outputs_index"
          UNIQUE ("generation_id", "output_index"),
        ADD CONSTRAINT "UQ_social_creative_generation_outputs_media"
          UNIQUE ("media_asset_id"),
        ADD CONSTRAINT "UQ_social_creative_generation_outputs_version"
          UNIQUE ("promoted_version_id"),
        ADD CONSTRAINT "CK_social_creative_generation_outputs_index"
          CHECK ("output_index" BETWEEN 0 AND 3),
        ADD CONSTRAINT "CK_social_creative_generation_outputs_promotion"
          CHECK (
            (
              "promotion_kind" IS NULL AND "promoted_creative_asset_id" IS NULL
              AND "promoted_version_id" IS NULL AND "promoted_at" IS NULL
              AND "promoted_by_id" IS NULL
            ) OR (
              "promotion_kind" IN ('new_asset', 'version', 'revision')
              AND "promoted_creative_asset_id" IS NOT NULL
              AND "promoted_version_id" IS NOT NULL
              AND "promoted_at" IS NOT NULL
            )
          ),
        ADD CONSTRAINT "FK_social_creative_generation_outputs_generation"
          FOREIGN KEY ("generation_id")
          REFERENCES "social_creative_generations" ("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_social_creative_generation_outputs_media"
          FOREIGN KEY ("media_asset_id")
          REFERENCES "media_assets" ("id") ON DELETE SET NULL,
        ADD CONSTRAINT "FK_social_creative_generation_outputs_asset"
          FOREIGN KEY ("promoted_creative_asset_id")
          REFERENCES "social_creative_assets" ("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_social_creative_generation_outputs_version"
          FOREIGN KEY ("promoted_version_id")
          REFERENCES "social_creative_asset_versions" ("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_generation_outputs_promoted_asset"
        ON "social_creative_generation_outputs" ("promoted_creative_asset_id")
        WHERE "promoted_creative_asset_id" IS NOT NULL
    `);

    // An output may only point at a temporary generation output of its own
    // generation's full scope, and only be promoted into an asset of that
    // scope — through a version of that very asset — once.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_creative_generation_output()
      RETURNS trigger AS $$
      DECLARE generation_scope record;
      DECLARE target record;
      BEGIN
        IF TG_OP = 'UPDATE' AND OLD."promoted_version_id" IS NOT NULL AND (
             NEW."promotion_kind" IS DISTINCT FROM OLD."promotion_kind" OR
             NEW."promoted_creative_asset_id" IS DISTINCT FROM OLD."promoted_creative_asset_id" OR
             NEW."promoted_version_id" IS DISTINCT FROM OLD."promoted_version_id"
           ) THEN
          RAISE EXCEPTION 'generation output promotion is write-once'
            USING ERRCODE = '23514';
        END IF;

        SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
          INTO generation_scope
          FROM "social_creative_generations" WHERE "id" = NEW."generation_id";

        IF NEW."media_asset_id" IS NOT NULL AND (
             TG_OP = 'INSERT' OR NEW."media_asset_id" IS DISTINCT FROM OLD."media_asset_id"
           ) THEN
          SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "source"
            INTO target
            FROM "media_assets" WHERE "id" = NEW."media_asset_id";
          IF target."source" IS DISTINCT FROM 'temporary:creative_generation' OR
             target."tenant_id" IS DISTINCT FROM generation_scope."tenant_id" OR
             target."workspace_id" IS DISTINCT FROM generation_scope."workspace_id" OR
             target."agency_client_id" IS DISTINCT FROM generation_scope."agency_client_id" OR
             target."company_context_id" IS DISTINCT FROM generation_scope."company_context_id" THEN
            RAISE EXCEPTION 'generation output media must be a temporary output of the generation scope'
              USING ERRCODE = '23514';
          END IF;
        END IF;

        IF NEW."promoted_version_id" IS NOT NULL AND (
             TG_OP = 'INSERT' OR NEW."promoted_version_id" IS DISTINCT FROM OLD."promoted_version_id"
           ) THEN
          SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
            INTO target
            FROM "social_creative_assets" WHERE "id" = NEW."promoted_creative_asset_id";
          IF target."tenant_id" IS DISTINCT FROM generation_scope."tenant_id" OR
             target."workspace_id" IS DISTINCT FROM generation_scope."workspace_id" OR
             target."agency_client_id" IS DISTINCT FROM generation_scope."agency_client_id" OR
             target."company_context_id" IS DISTINCT FROM generation_scope."company_context_id" OR
             NOT EXISTS (
               SELECT 1 FROM "social_creative_asset_versions"
                WHERE "id" = NEW."promoted_version_id"
                  AND "creative_asset_id" = NEW."promoted_creative_asset_id"
             ) THEN
            RAISE EXCEPTION 'generation output must be promoted into a version of an asset of the generation scope'
              USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_generation_outputs_scope" ON "social_creative_generation_outputs"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_creative_generation_outputs_scope"
      BEFORE INSERT OR UPDATE OF
        "generation_id", "media_asset_id", "promotion_kind",
        "promoted_creative_asset_id", "promoted_version_id"
      ON "social_creative_generation_outputs"
      FOR EACH ROW EXECUTE FUNCTION validate_social_creative_generation_output()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_creative_generation_outputs"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS validate_social_creative_generation_output()',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_creative_generations"',
    );
  }
}
