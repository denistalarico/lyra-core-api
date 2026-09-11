import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Copy generation runs and their staged proposals (Planner E8).
 *
 * WHY THESE TABLES EXIST AT ALL
 * -----------------------------
 * `social_content_revisions` already has a `generation_run_id` column with a
 * comment saying the shared generation-run persistence "is being established
 * independently". The E8 audit established that it never was: there is no
 * generation-run table anywhere in this service, `common/intelligence` holds
 * analytics contracts with no provider call, and the `leadflow_intelligence_*`
 * tables are LeadFlow recommendation rows. This migration gives that dangling
 * column something real to point at.
 *
 * TWO TABLES, NOT ONE
 * -------------------
 * A run is one provider attempt with one cost and one latency. A proposal is
 * one field an operator accepts or rejects on its own — someone keeps the
 * caption and discards the CTA constantly. Flattening them would either repeat
 * the cost on six rows (and double-count it in the §8.6 profitability sum) or
 * force a single all-or-nothing verdict on the whole run.
 *
 * FOREIGN KEY POLICY
 * ------------------
 *   - `content_item_id` CASCADE on both tables: a run is a statement about one
 *     content item and means nothing once that item is gone. This is safe
 *     precisely because E6 made content deletion a soft delete — a published
 *     item never leaves the table, so CASCADE here cannot erase the history of
 *     anything that actually published.
 *   - `plan_id` CASCADE: same reasoning, one level up.
 *   - `run_id` CASCADE: a proposal without its run has no provenance left to
 *     report, which is the only reason it was kept.
 *   - No FK on `applied_revision_id`, matching the existing, deliberate absence
 *     of one on `social_content_revisions.generation_run_id`. Revisions are
 *     append-only evidence and are never deleted, so the FK would buy nothing
 *     that is not already true.
 *
 * THE UNIQUE INDEXES ARE THE REAL GUARANTEES
 * ------------------------------------------
 *   - One in-flight run per content item, as a partial unique index on the two
 *     non-terminal statuses. This is what makes a double-clicked "generate"
 *     button cost one provider call instead of two, enforced by the database
 *     rather than by a service that checks first and races anyway.
 *   - One proposal per (run, field), so a provider that repeats itself inside a
 *     single response cannot produce two competing values for one caption.
 *   - Idempotency key unique per scope, the same shape
 *     `leadflow_briefing_extraction_jobs` uses.
 */
export class CreateSocialCopyGeneration1792800000000 implements MigrationInterface {
  name = 'CreateSocialCopyGeneration1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_copy_generation_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),

        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        "plan_id" uuid NOT NULL,
        "content_item_id" uuid NOT NULL,

        "run_kind" varchar(40) NOT NULL DEFAULT 'content_copy',
        "idempotency_key" varchar(180) NOT NULL,

        "status" varchar(20) NOT NULL DEFAULT 'queued',
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 3,

        "available_at" timestamptz NOT NULL DEFAULT now(),
        "locked_at" timestamptz,
        "locked_by" varchar(120),

        "started_at" timestamptz,
        "completed_at" timestamptz,
        "failed_at" timestamptz,
        "cancelled_at" timestamptz,
        "dead_lettered_at" timestamptz,

        "last_error" varchar(120),

        "provider" varchar(80),
        "model" varchar(120),
        "prompt_version" varchar(40),
        "context_version" varchar(40),

        "input_tokens" integer,
        "cached_input_tokens" integer,
        "output_tokens" integer,

        "cost_cents" integer,
        "cost_is_estimated" boolean NOT NULL DEFAULT true,
        "latency_ms" integer,

        "requested_fields" jsonb,
        "instruction" varchar(500),

        "requested_by_id" uuid,

        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_copy_generation_runs" PRIMARY KEY ("id"),

        CONSTRAINT "FK_social_copy_generation_runs_plan"
          FOREIGN KEY ("plan_id")
          REFERENCES "social_plans" ("id")
          ON DELETE CASCADE,

        CONSTRAINT "FK_social_copy_generation_runs_content_item"
          FOREIGN KEY ("content_item_id")
          REFERENCES "social_content_items" ("id")
          ON DELETE CASCADE,

        CONSTRAINT "CK_social_copy_generation_runs_status"
          CHECK ("status" IN (
            'queued', 'processing', 'succeeded',
            'failed', 'cancelled', 'dead_letter'
          )),

        CONSTRAINT "CK_social_copy_generation_runs_kind"
          CHECK ("run_kind" IN ('content_copy', 'plan_copy', 'selection_copy')),

        CONSTRAINT "CK_social_copy_generation_runs_attempts"
          CHECK ("attempts" >= 0 AND "max_attempts" > 0),

        CONSTRAINT "CK_social_copy_generation_runs_cost"
          CHECK ("cost_cents" IS NULL OR "cost_cents" >= 0),

        CONSTRAINT "CK_social_copy_generation_runs_requested_fields"
          CHECK (
            "requested_fields" IS NULL
            OR jsonb_typeof("requested_fields") = 'array'
          ),

        CONSTRAINT "CK_social_copy_generation_runs_tokens"
          CHECK (
            ("input_tokens" IS NULL OR "input_tokens" >= 0)
            AND ("cached_input_tokens" IS NULL OR "cached_input_tokens" >= 0)
            AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_copy_generation_runs_scope"
        ON "social_copy_generation_runs" (
          "tenant_id", "workspace_id", "agency_client_id"
        )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_copy_generation_runs_content"
        ON "social_copy_generation_runs" ("content_item_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_copy_generation_runs_claim"
        ON "social_copy_generation_runs" (
          "status", "available_at", "locked_at"
        )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_copy_generation_runs_idempotency"
        ON "social_copy_generation_runs" (
          "tenant_id", "workspace_id", "idempotency_key"
        )
    `);

    /**
     * At most one live run per content item. Partial on the two non-terminal
     * statuses so a finished run never blocks the next request, while two
     * concurrent requests for the same item cannot both reach the provider.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_copy_generation_runs_in_flight"
        ON "social_copy_generation_runs" ("content_item_id")
        WHERE "status" IN ('queued', 'processing')
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_copy_generation_proposals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),

        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        "run_id" uuid NOT NULL,
        "content_item_id" uuid NOT NULL,

        "field" varchar(40) NOT NULL,
        "value" jsonb NOT NULL,
        "base_value" jsonb,
        "rationale" varchar(500),

        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "applied_revision_id" uuid,

        "decided_by_id" uuid,
        "decided_at" timestamptz,

        "created_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_copy_generation_proposals" PRIMARY KEY ("id"),

        CONSTRAINT "FK_social_copy_generation_proposals_run"
          FOREIGN KEY ("run_id")
          REFERENCES "social_copy_generation_runs" ("id")
          ON DELETE CASCADE,

        CONSTRAINT "FK_social_copy_generation_proposals_content_item"
          FOREIGN KEY ("content_item_id")
          REFERENCES "social_content_items" ("id")
          ON DELETE CASCADE,

        CONSTRAINT "CK_social_copy_generation_proposals_field"
          CHECK ("field" IN (
            'copy', 'caption', 'script', 'cta', 'hashtags', 'first_comment'
          )),

        CONSTRAINT "CK_social_copy_generation_proposals_status"
          CHECK ("status" IN (
            'pending', 'accepted', 'rejected', 'superseded'
          )),

        CONSTRAINT "CK_social_copy_generation_proposals_decision"
          CHECK (
            ("status" = 'pending' AND "decided_at" IS NULL)
            OR ("status" <> 'pending')
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_copy_proposals_scope"
        ON "social_copy_generation_proposals" (
          "tenant_id", "workspace_id", "agency_client_id"
        )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_copy_proposals_content"
        ON "social_copy_generation_proposals" ("content_item_id", "status")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_copy_proposals_run_field"
        ON "social_copy_generation_proposals" ("run_id", "field")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_copy_generation_proposals"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_copy_generation_runs"',
    );
  }
}
