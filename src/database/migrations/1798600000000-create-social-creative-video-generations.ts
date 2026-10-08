import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CS4-B — Reel (video) generation for the Creative Studio.
 *
 *   social_creative_video_avatars                 provider-neutral projection of
 *                                                 the avatars UGC may use (global
 *                                                 preset looks; no binary copied)
 *   social_creative_video_generations             one request AND its job
 *   social_creative_video_generation_operations   the provider jobs it took
 *                                                 (initial + native extensions),
 *                                                 each with its cost snapshot
 *   social_creative_video_generation_references   frozen reference images
 *
 * WHY NOT `social_creative_generations`
 * -------------------------------------
 * The image table's invariants are image invariants: 1–4 outputs in a child
 * table, a 4000-char prompt, four aspect ratios, a single synchronous
 * provider call whose lease covers the whole job, a claim loop where
 * `processing` means "a worker holds it". A Reel is one output, a script or a
 * prompt, 9:16 only, and minutes of REMOTE work across several paid provider
 * jobs. Folding both into one row would loosen every CHECK on both sides.
 * The shared parts are reused as code (scope, references selector, media
 * boundary, Creative Asset promotion, cleanup worker), not as a table.
 *
 * WHY `processing` IS NOT A LOCK HERE
 * -----------------------------------
 * A provider job runs for minutes; holding a worker lease for that long would
 * pin a slot and make the lease meaningless. A generation is `processing`
 * from its first step until it is terminal; `locked_by`/`locked_at` are held
 * only during one short step (submit, one status poll, the download), and
 * `available_at` schedules the next step. Callbacks only move `available_at`.
 *
 * PAID-JOB SAFETY IN THE SCHEMA
 * -----------------------------
 * - `provider_job_id` is write-once on the operation (and on the generation's
 *   initial-job copy) and unique per provider: a second submit can never be
 *   recorded over the first, and one provider job can never belong to two
 *   operations.
 * - An operation in `submitting` (request sent, answer unknown) cannot go back
 *   to `pending` except by an explicit recovery proving no job exists — the
 *   worker enforces it; the CHECK keeps `dispatch_started_at` present there.
 * - A terminal operation (succeeded/failed) is immutable: its cost snapshot
 *   cannot be rewritten after the fact.
 *
 * Every statement is re-runnable (specs call `up()` against migrated schemas).
 */
export class CreateSocialCreativeVideoGenerations1798600000000 implements MigrationInterface {
  name = 'CreateSocialCreativeVideoGenerations1798600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_creative_video_avatars" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "provider" varchar(80) NOT NULL,
        "provider_avatar_id" varchar(160) NOT NULL,
        "name" varchar(160) NOT NULL,
        "avatar_type" varchar(40) NOT NULL,
        "gender" varchar(20),
        "orientation" varchar(20),
        "supported_engines" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "provider_voice_id" varchar(160),
        "preview_image_url" text,
        "available" boolean NOT NULL DEFAULT true,
        "synced_at" timestamptz NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_creative_video_avatars" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_social_creative_video_avatars_provider"
          UNIQUE ("provider", "provider_avatar_id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_creative_video_generations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "company_context_id" uuid,
        "mode" varchar(24) NOT NULL,
        "input_kind" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'queued',
        "prompt" text,
        "script" text,
        "script_source" varchar(16),
        "content_item_id" uuid,
        "avatar_id" uuid,
        "language" varchar(16),
        "effective_prompt" text,
        "generation_context" jsonb,
        "duration_requested_seconds" smallint,
        "duration_actual_seconds" numeric(8,3),
        "aspect_ratio" varchar(8) NOT NULL,
        "quality" varchar(16) NOT NULL,
        "audio_requested" boolean NOT NULL DEFAULT false,
        "has_audio" boolean,
        "provider" varchar(80) NOT NULL,
        "provider_model" varchar(120),
        "provider_job_id" varchar(160),
        "idempotency_key" varchar(180) NOT NULL,
        "request_fingerprint" char(64) NOT NULL,
        "transient_failures" smallint NOT NULL DEFAULT 0,
        "max_step_retries" smallint NOT NULL,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "deadline_at" timestamptz NOT NULL,
        "locked_at" timestamptz,
        "locked_by" varchar(120),
        "error_code" varchar(40),
        "error_retryable" boolean,
        "cost_amount" numeric(18,6),
        "cost_currency" char(3),
        "output_media_asset_id" uuid,
        "poster_media_asset_id" uuid,
        "promotion_kind" varchar(16),
        "promoted_creative_asset_id" uuid,
        "promoted_version_id" uuid,
        "promoted_by_id" uuid,
        "promoted_at" timestamptz,
        "requested_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "started_at" timestamptz,
        "submitted_at" timestamptz,
        "completed_at" timestamptz,
        "failed_at" timestamptz,
        CONSTRAINT "PK_social_creative_video_generations" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "social_creative_video_generations"
        DROP CONSTRAINT IF EXISTS "CK_social_creative_video_generations_company_scope",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_video_generations_mode",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_video_generations_status",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_video_generations_request",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_video_generations_lifecycle",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_video_generations_error",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_video_generations_cost",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_video_generations_promotion",
        DROP CONSTRAINT IF EXISTS "UQ_social_creative_video_generations_version",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_video_generations_company_context",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_video_generations_content_item",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_video_generations_avatar",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_video_generations_output",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_video_generations_poster",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_video_generations_asset",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_video_generations_version",
        ADD CONSTRAINT "CK_social_creative_video_generations_company_scope"
          CHECK ("company_context_id" IS NULL OR "agency_client_id" IS NOT NULL),
        ADD CONSTRAINT "CK_social_creative_video_generations_mode"
          CHECK (
            ("mode" = 'generative_reel'
              AND "input_kind" IN ('text', 'image', 'reference')
              AND char_length("prompt") BETWEEN 1 AND 4000
              AND "effective_prompt" IS NOT NULL
              AND char_length("effective_prompt") <= 8000
              AND "script" IS NULL AND "script_source" IS NULL
              AND "avatar_id" IS NULL
              AND "duration_requested_seconds" BETWEEN 5 AND 30)
            OR
            ("mode" = 'ugc_avatar'
              AND "input_kind" = 'avatar'
              AND char_length("script") BETWEEN 1 AND 1500
              AND "script_source" IN ('operator', 'planner')
              AND "avatar_id" IS NOT NULL
              AND "prompt" IS NULL
              AND "audio_requested" = false
              AND ("duration_requested_seconds" IS NULL
                   OR "duration_requested_seconds" BETWEEN 5 AND 30))
          ),
        ADD CONSTRAINT "CK_social_creative_video_generations_status"
          CHECK ("status" IN ('queued', 'processing', 'completed', 'failed')),
        ADD CONSTRAINT "CK_social_creative_video_generations_request"
          CHECK (
            "aspect_ratio" = '9:16'
            AND "quality" IN ('standard', 'high')
            AND ("language" IS NULL OR "language" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
            AND "max_step_retries" >= 1
            AND "transient_failures" >= 0
            AND ("content_item_id" IS NULL OR "generation_context" IS NOT NULL)
          ),
        ADD CONSTRAINT "CK_social_creative_video_generations_lifecycle"
          CHECK (
            ("locked_by" IS NULL) = ("locked_at" IS NULL)
            AND ("locked_by" IS NULL OR "status" = 'processing')
            -- No "output IS NOT NULL" here: lifecycle cleanup deletes the
            -- temporary binary and the FK sets it NULL on a completed row.
            AND ("status" <> 'completed' OR (
                  "completed_at" IS NOT NULL AND "error_code" IS NULL
                  AND "duration_actual_seconds" IS NOT NULL))
            AND ("status" <> 'failed' OR ("failed_at" IS NOT NULL AND "error_code" IS NOT NULL))
            AND ("status" = 'completed' OR "promoted_version_id" IS NULL)
          ),
        ADD CONSTRAINT "CK_social_creative_video_generations_error"
          CHECK (
            "error_code" IS NULL OR "error_code" IN (
              'unavailable', 'rejected', 'rate_limited', 'timeout',
              'reference_unavailable', 'provider_failed',
              'insufficient_provider_balance', 'avatar_unavailable', 'invalid_output'
            )
          ),
        ADD CONSTRAINT "CK_social_creative_video_generations_cost"
          CHECK (
            ("cost_amount" IS NULL) = ("cost_currency" IS NULL)
            AND ("cost_amount" IS NULL OR "cost_amount" >= 0)
          ),
        ADD CONSTRAINT "CK_social_creative_video_generations_promotion"
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
        ADD CONSTRAINT "UQ_social_creative_video_generations_version"
          UNIQUE ("promoted_version_id"),
        ADD CONSTRAINT "FK_social_creative_video_generations_company_context"
          FOREIGN KEY ("company_context_id", "tenant_id", "workspace_id", "agency_client_id")
          REFERENCES "agency_client_company_contexts" ("id", "tenant_id", "workspace_id", "agency_client_id")
          ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_social_creative_video_generations_content_item"
          FOREIGN KEY ("content_item_id") REFERENCES "social_content_items" ("id")
          ON DELETE SET NULL,
        ADD CONSTRAINT "FK_social_creative_video_generations_avatar"
          FOREIGN KEY ("avatar_id") REFERENCES "social_creative_video_avatars" ("id")
          ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_social_creative_video_generations_output"
          FOREIGN KEY ("output_media_asset_id") REFERENCES "media_assets" ("id")
          ON DELETE SET NULL,
        ADD CONSTRAINT "FK_social_creative_video_generations_poster"
          FOREIGN KEY ("poster_media_asset_id") REFERENCES "media_assets" ("id")
          ON DELETE SET NULL,
        ADD CONSTRAINT "FK_social_creative_video_generations_asset"
          FOREIGN KEY ("promoted_creative_asset_id") REFERENCES "social_creative_assets" ("id")
          ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_social_creative_video_generations_version"
          FOREIGN KEY ("promoted_version_id") REFERENCES "social_creative_asset_versions" ("id")
          ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_creative_video_generations_idempotency"
        ON "social_creative_video_generations" (
          "tenant_id",
          "workspace_id",
          COALESCE("agency_client_id", '00000000-0000-0000-0000-000000000000'::uuid),
          COALESCE("company_context_id", '00000000-0000-0000-0000-000000000000'::uuid),
          "idempotency_key"
        )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_video_generations_scope"
        ON "social_creative_video_generations" (
          "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "created_at"
        )
    `);
    // The claim loop only reads the pending slice.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_video_generations_due"
        ON "social_creative_video_generations" ("available_at", "id")
        WHERE "status" IN ('queued', 'processing')
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_video_generations_content"
        ON "social_creative_video_generations" ("content_item_id")
        WHERE "content_item_id" IS NOT NULL
    `);
    // Cleanup's owner checks look media up by these.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_video_generations_output_media"
        ON "social_creative_video_generations" ("output_media_asset_id")
        WHERE "output_media_asset_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_video_generations_poster_media"
        ON "social_creative_video_generations" ("poster_media_asset_id")
        WHERE "poster_media_asset_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_creative_video_generation_operations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "generation_id" uuid NOT NULL,
        "sequence" smallint NOT NULL,
        "kind" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "duration_seconds" smallint,
        "provider" varchar(80) NOT NULL,
        "provider_model" varchar(120),
        "provider_operation" varchar(40),
        "resolution" varchar(16),
        "dispatch_key" varchar(180),
        "submit_attempts" smallint NOT NULL DEFAULT 0,
        "dispatch_started_at" timestamptz,
        "accepted_at" timestamptz,
        "completed_at" timestamptz,
        "failed_at" timestamptz,
        "provider_job_id" varchar(160),
        "provider_output_ref" varchar(160),
        "output_duration_seconds" numeric(8,3),
        "usage_metrics" jsonb,
        "billed_units" numeric(18,3),
        "unit_kind" varchar(80),
        "unit_price" numeric(18,8),
        "pricing_version" varchar(80),
        "cost_amount" numeric(18,6),
        "cost_currency" char(3),
        "cost_source" varchar(24),
        "error_code" varchar(40),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_creative_video_generation_operations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "social_creative_video_generation_operations"
        DROP CONSTRAINT IF EXISTS "UQ_social_creative_video_operations_sequence",
        DROP CONSTRAINT IF EXISTS "UQ_social_creative_video_operations_job",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_video_operations_shape",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_video_operations_lifecycle",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_video_operations_cost",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_video_operations_generation",
        ADD CONSTRAINT "UQ_social_creative_video_operations_sequence"
          UNIQUE ("generation_id", "sequence"),
        ADD CONSTRAINT "UQ_social_creative_video_operations_job"
          UNIQUE ("provider", "provider_job_id"),
        ADD CONSTRAINT "CK_social_creative_video_operations_shape"
          CHECK (
            "sequence" BETWEEN 0 AND 8
            AND "kind" IN ('generate', 'extend')
            AND ("kind" = 'generate') = ("sequence" = 0)
            AND ("duration_seconds" IS NULL OR "duration_seconds" BETWEEN 1 AND 30)
            AND "submit_attempts" >= 0
          ),
        ADD CONSTRAINT "CK_social_creative_video_operations_lifecycle"
          CHECK (
            "status" IN ('pending', 'submitting', 'submitted', 'succeeded', 'failed')
            AND ("status" <> 'submitting' OR ("dispatch_started_at" IS NOT NULL AND "dispatch_key" IS NOT NULL))
            AND ("status" NOT IN ('submitted', 'succeeded') OR (
                  "provider_job_id" IS NOT NULL AND "accepted_at" IS NOT NULL))
            AND ("status" <> 'succeeded' OR "completed_at" IS NOT NULL)
            AND ("status" <> 'failed' OR ("failed_at" IS NOT NULL AND "error_code" IS NOT NULL))
          ),
        ADD CONSTRAINT "CK_social_creative_video_operations_cost"
          CHECK (
            ("cost_amount" IS NULL) = ("cost_currency" IS NULL)
            AND ("cost_amount" IS NULL) = ("cost_source" IS NULL)
            AND ("cost_amount" IS NULL) = ("pricing_version" IS NULL)
            AND ("cost_amount" IS NULL OR "cost_amount" >= 0)
            AND ("cost_source" IS NULL OR "cost_source" IN ('provider_reported', 'lyra_calculated'))
          ),
        ADD CONSTRAINT "FK_social_creative_video_operations_generation"
          FOREIGN KEY ("generation_id") REFERENCES "social_creative_video_generations" ("id")
          ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_creative_video_generation_references" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "generation_id" uuid NOT NULL,
        "position" smallint NOT NULL,
        "purpose" varchar(16) NOT NULL,
        "source" varchar(16) NOT NULL,
        "kind" varchar(40) NOT NULL,
        "brand_kit_asset_id" uuid,
        "media_asset_id" uuid,
        "mime_type" varchar(32) NOT NULL,
        "byte_size" bigint NOT NULL,
        "checksum" char(64) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_social_creative_video_generation_references" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "social_creative_video_generation_references"
        DROP CONSTRAINT IF EXISTS "UQ_social_creative_video_references_position",
        DROP CONSTRAINT IF EXISTS "CK_social_creative_video_references_shape",
        DROP CONSTRAINT IF EXISTS "FK_social_creative_video_references_generation",
        ADD CONSTRAINT "UQ_social_creative_video_references_position"
          UNIQUE ("generation_id", "position"),
        ADD CONSTRAINT "CK_social_creative_video_references_shape"
          CHECK (
            "position" BETWEEN 0 AND 6
            AND "purpose" IN ('start_frame', 'reference', 'background')
            AND "source" IN ('brand', 'planner', 'operator')
            AND (("brand_kit_asset_id" IS NULL) <> ("media_asset_id" IS NULL))
            AND ("source" = 'brand') = ("brand_kit_asset_id" IS NOT NULL)
            AND "byte_size" > 0
          ),
        ADD CONSTRAINT "FK_social_creative_video_references_generation"
          FOREIGN KEY ("generation_id") REFERENCES "social_creative_video_generations" ("id")
          ON DELETE RESTRICT
    `);

    // ── Triggers ────────────────────────────────────────────────────────
    // Generation: initial job id write-once; promotion write-once; output and
    // poster media are temporary video outputs of the generation's own scope;
    // promoted into a version of an asset of that scope.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_creative_video_generation()
      RETURNS trigger AS $$
      DECLARE target record;
      BEGIN
        IF TG_OP = 'UPDATE' THEN
          IF OLD."provider_job_id" IS NOT NULL
             AND NEW."provider_job_id" IS DISTINCT FROM OLD."provider_job_id" THEN
            RAISE EXCEPTION 'video generation provider job id is write-once'
              USING ERRCODE = '23514';
          END IF;
          IF OLD."promoted_version_id" IS NOT NULL AND (
               NEW."promotion_kind" IS DISTINCT FROM OLD."promotion_kind" OR
               NEW."promoted_creative_asset_id" IS DISTINCT FROM OLD."promoted_creative_asset_id" OR
               NEW."promoted_version_id" IS DISTINCT FROM OLD."promoted_version_id"
             ) THEN
            RAISE EXCEPTION 'video generation promotion is write-once'
              USING ERRCODE = '23514';
          END IF;
          IF OLD."status" IN ('completed', 'failed')
             AND NEW."status" IS DISTINCT FROM OLD."status" THEN
            RAISE EXCEPTION 'video generation status is terminal'
              USING ERRCODE = '23514';
          END IF;
          IF NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id" OR
             NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id" OR
             NEW."agency_client_id" IS DISTINCT FROM OLD."agency_client_id" OR
             NEW."company_context_id" IS DISTINCT FROM OLD."company_context_id" OR
             NEW."mode" IS DISTINCT FROM OLD."mode" OR
             NEW."request_fingerprint" IS DISTINCT FROM OLD."request_fingerprint" OR
             NEW."effective_prompt" IS DISTINCT FROM OLD."effective_prompt" OR
             NEW."script" IS DISTINCT FROM OLD."script" THEN
            RAISE EXCEPTION 'video generation request is immutable'
              USING ERRCODE = '23514';
          END IF;
        END IF;

        IF NEW."output_media_asset_id" IS NOT NULL AND (
             TG_OP = 'INSERT' OR NEW."output_media_asset_id" IS DISTINCT FROM OLD."output_media_asset_id") THEN
          SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "source"
            INTO target FROM "media_assets" WHERE "id" = NEW."output_media_asset_id";
          IF target."source" IS DISTINCT FROM 'temporary:creative_video_generation' OR
             target."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
             target."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
             target."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
             target."company_context_id" IS DISTINCT FROM NEW."company_context_id" THEN
            RAISE EXCEPTION 'video output must be a temporary video output of the generation scope'
              USING ERRCODE = '23514';
          END IF;
        END IF;

        IF NEW."poster_media_asset_id" IS NOT NULL AND (
             TG_OP = 'INSERT' OR NEW."poster_media_asset_id" IS DISTINCT FROM OLD."poster_media_asset_id") THEN
          SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "source"
            INTO target FROM "media_assets" WHERE "id" = NEW."poster_media_asset_id";
          IF target."source" IS DISTINCT FROM 'temporary:creative_video_generation' OR
             target."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
             target."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
             target."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
             target."company_context_id" IS DISTINCT FROM NEW."company_context_id" THEN
            RAISE EXCEPTION 'video poster must be a temporary video output of the generation scope'
              USING ERRCODE = '23514';
          END IF;
        END IF;

        IF NEW."promoted_version_id" IS NOT NULL AND (
             TG_OP = 'INSERT' OR NEW."promoted_version_id" IS DISTINCT FROM OLD."promoted_version_id") THEN
          SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "asset_type"
            INTO target FROM "social_creative_assets" WHERE "id" = NEW."promoted_creative_asset_id";
          IF target."asset_type" IS DISTINCT FROM 'video' OR
             target."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
             target."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
             target."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
             target."company_context_id" IS DISTINCT FROM NEW."company_context_id" OR
             NOT EXISTS (
               SELECT 1 FROM "social_creative_asset_versions"
                WHERE "id" = NEW."promoted_version_id"
                  AND "creative_asset_id" = NEW."promoted_creative_asset_id"
             ) THEN
            RAISE EXCEPTION 'video generation must be promoted into a version of a video asset of its scope'
              USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_video_generations_guard" ON "social_creative_video_generations"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_creative_video_generations_guard"
      BEFORE INSERT OR UPDATE ON "social_creative_video_generations"
      FOR EACH ROW EXECUTE FUNCTION validate_social_creative_video_generation()
    `);

    // Operation: job id write-once; terminal operations are immutable (their
    // cost snapshot included); identity columns never move.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_creative_video_operation()
      RETURNS trigger AS $$
      BEGIN
        IF OLD."provider_job_id" IS NOT NULL
           AND NEW."provider_job_id" IS DISTINCT FROM OLD."provider_job_id" THEN
          RAISE EXCEPTION 'video operation provider job id is write-once'
            USING ERRCODE = '23514';
        END IF;
        IF OLD."status" IN ('succeeded', 'failed') AND ROW(NEW.*) IS DISTINCT FROM ROW(OLD.*) THEN
          RAISE EXCEPTION 'terminal video operation is immutable'
            USING ERRCODE = '23514';
        END IF;
        IF NEW."generation_id" IS DISTINCT FROM OLD."generation_id" OR
           NEW."sequence" IS DISTINCT FROM OLD."sequence" OR
           NEW."kind" IS DISTINCT FROM OLD."kind" OR
           NEW."provider" IS DISTINCT FROM OLD."provider" THEN
          RAISE EXCEPTION 'video operation identity is immutable'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_video_operations_guard" ON "social_creative_video_generation_operations"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_creative_video_operations_guard"
      BEFORE UPDATE ON "social_creative_video_generation_operations"
      FOR EACH ROW EXECUTE FUNCTION validate_social_creative_video_operation()
    `);

    // References: inserted only with a fresh queued generation, never changed.
    // Owner rows must exist in the generation's exact scope with the frozen
    // checksum (the worker re-verifies the bytes before any provider call).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_creative_video_reference()
      RETURNS trigger AS $$
      DECLARE generation record;
      DECLARE owner record;
      BEGIN
        IF TG_OP <> 'INSERT' THEN
          RAISE EXCEPTION 'video generation references are immutable'
            USING ERRCODE = '23514';
        END IF;
        SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "status"
          INTO generation FROM "social_creative_video_generations" WHERE "id" = NEW."generation_id";
        IF generation."status" IS DISTINCT FROM 'queued' THEN
          RAISE EXCEPTION 'video references can only be frozen at enqueue'
            USING ERRCODE = '23514';
        END IF;
        IF NEW."media_asset_id" IS NOT NULL THEN
          SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id",
                 "source", "checksum", "deleted_at"
            INTO owner FROM "media_assets" WHERE "id" = NEW."media_asset_id";
          IF owner."tenant_id" IS DISTINCT FROM generation."tenant_id" OR
             owner."workspace_id" IS DISTINCT FROM generation."workspace_id" OR
             owner."agency_client_id" IS DISTINCT FROM generation."agency_client_id" OR
             owner."company_context_id" IS DISTINCT FROM generation."company_context_id" OR
             owner."source" LIKE 'temporary:%' OR
             owner."deleted_at" IS NOT NULL OR
             owner."checksum" IS DISTINCT FROM NEW."checksum" THEN
            RAISE EXCEPTION 'video reference media must be durable media of the generation scope'
              USING ERRCODE = '23514';
          END IF;
        ELSE
          -- Company Context of a Brand Kit asset is its kit's (CS3.4.2).
          SELECT asset."tenant_id", asset."workspace_id", asset."agency_client_id",
                 kit."company_context_id", asset."checksum", asset."deleted_at"
            INTO owner
            FROM "brand_kit_assets" asset
            JOIN "brand_kits" kit ON kit."id" = asset."brand_kit_id"
           WHERE asset."id" = NEW."brand_kit_asset_id";
          IF NOT FOUND OR
             owner."deleted_at" IS NOT NULL OR
             owner."checksum" IS DISTINCT FROM NEW."checksum" OR
             owner."tenant_id" IS DISTINCT FROM generation."tenant_id" OR
             owner."workspace_id" IS DISTINCT FROM generation."workspace_id" OR
             owner."agency_client_id" IS DISTINCT FROM generation."agency_client_id" OR
             owner."company_context_id" IS DISTINCT FROM generation."company_context_id" THEN
            RAISE EXCEPTION 'video reference brand asset must belong to the generation scope'
              USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_video_references_guard" ON "social_creative_video_generation_references"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_creative_video_references_guard"
      BEFORE INSERT OR UPDATE OR DELETE ON "social_creative_video_generation_references"
      FOR EACH ROW EXECUTE FUNCTION validate_social_creative_video_reference()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_creative_video_generation_references"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_creative_video_generation_operations"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_creative_video_generations"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_creative_video_avatars"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS validate_social_creative_video_reference()',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS validate_social_creative_video_operation()',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS validate_social_creative_video_generation()',
    );
  }
}
