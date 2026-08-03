import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * LF-RF-F4-001: models sources/versions/extraction jobs/suggestions/context
 * snapshots/applications for the LeadFlow Briefing pipeline ("separar fonte,
 * job, sugestão, aplicação e publicação"). No extraction/ingestion runs yet —
 * this only creates the tables the RFC's state machine relies on. Tables are
 * created in FK-safe order; down() drops them in reverse.
 */
export class CreateLeadflowBriefingProvenance1788500000000
  implements MigrationInterface
{
  name = 'CreateLeadflowBriefingProvenance1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_briefing_sources" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "context_type" character varying(30) NOT NULL DEFAULT 'client',
        "agency_client_id" uuid,
        "settings_id" uuid NOT NULL,
        "kind" character varying(20) NOT NULL DEFAULT 'upload',
        "label" character varying(160) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "latest_version_number" integer NOT NULL DEFAULT 0,
        "created_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "archived_at" timestamptz,
        CONSTRAINT "PK_lf_briefing_sources" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_briefing_sources_settings" FOREIGN KEY ("settings_id")
          REFERENCES "leadflow_client_settings" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CK_lf_briefing_sources_kind" CHECK ("kind" IN ('upload', 'url', 'paste')),
        CONSTRAINT "CK_lf_briefing_sources_status" CHECK ("status" IN ('active', 'archived'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_briefing_sources_scope"
      ON "leadflow_briefing_sources" ("tenant_id", "workspace_id", "settings_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_briefing_sources_status"
      ON "leadflow_briefing_sources" ("tenant_id", "workspace_id", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_briefing_source_versions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "source_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "version_number" integer NOT NULL,
        "kind" character varying(20) NOT NULL,
        "object_key" text,
        "source_url" text,
        "raw_text" text,
        "mime_type" character varying(120),
        "byte_size" bigint,
        "checksum" character varying(128),
        "safe_filename" character varying(220),
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "error_code" character varying(80),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_briefing_source_versions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_briefing_source_versions_source" FOREIGN KEY ("source_id")
          REFERENCES "leadflow_briefing_sources" ("id") ON DELETE CASCADE,
        CONSTRAINT "CK_lf_briefing_source_versions_status" CHECK (
          "status" IN ('pending', 'processing', 'available', 'failed')
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_briefing_source_versions_number"
      ON "leadflow_briefing_source_versions" ("source_id", "version_number")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_briefing_source_versions_checksum"
      ON "leadflow_briefing_source_versions" ("source_id", "checksum")
      WHERE "checksum" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_briefing_source_versions_scope"
      ON "leadflow_briefing_source_versions" ("tenant_id", "workspace_id", "source_id", "version_number" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_briefing_extraction_jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "settings_id" uuid NOT NULL,
        "source_id" uuid NOT NULL,
        "source_version_id" uuid NOT NULL,
        "job_kind" character varying(40) NOT NULL DEFAULT 'ai_extraction',
        "idempotency_key" character varying(180) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'queued',
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 5,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "locked_at" timestamptz,
        "locked_by" character varying(120),
        "started_at" timestamptz,
        "completed_at" timestamptz,
        "failed_at" timestamptz,
        "cancelled_at" timestamptz,
        "dead_lettered_at" timestamptz,
        "last_error" character varying(120),
        "cost_budget_cents" integer,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_briefing_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_briefing_jobs_settings" FOREIGN KEY ("settings_id")
          REFERENCES "leadflow_client_settings" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_lf_briefing_jobs_source" FOREIGN KEY ("source_id")
          REFERENCES "leadflow_briefing_sources" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_lf_briefing_jobs_source_version" FOREIGN KEY ("source_version_id")
          REFERENCES "leadflow_briefing_source_versions" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CK_lf_briefing_jobs_status" CHECK (
          "status" IN ('queued', 'processing', 'succeeded', 'failed', 'cancelled', 'dead_letter')
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_briefing_jobs_idempotency"
      ON "leadflow_briefing_extraction_jobs" ("tenant_id", "workspace_id", "idempotency_key")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_briefing_jobs_claim"
      ON "leadflow_briefing_extraction_jobs" ("status", "available_at", "locked_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_briefing_jobs_scope"
      ON "leadflow_briefing_extraction_jobs" ("tenant_id", "workspace_id", "source_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_briefing_suggestions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "settings_id" uuid NOT NULL,
        "extraction_job_id" uuid NOT NULL,
        "source_version_id" uuid NOT NULL,
        "field_path" character varying(200) NOT NULL,
        "suggested_value" jsonb NOT NULL,
        "confidence" numeric(4,3),
        "rationale" character varying(500),
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "superseded_by_suggestion_id" uuid,
        "conflicts_with_suggestion_id" uuid,
        "decided_by_id" uuid,
        "decided_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_briefing_suggestions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_briefing_suggestions_job" FOREIGN KEY ("extraction_job_id")
          REFERENCES "leadflow_briefing_extraction_jobs" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_lf_briefing_suggestions_source_version" FOREIGN KEY ("source_version_id")
          REFERENCES "leadflow_briefing_source_versions" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_lf_briefing_suggestions_superseded_by" FOREIGN KEY ("superseded_by_suggestion_id")
          REFERENCES "leadflow_briefing_suggestions" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_lf_briefing_suggestions_conflicts_with" FOREIGN KEY ("conflicts_with_suggestion_id")
          REFERENCES "leadflow_briefing_suggestions" ("id") ON DELETE SET NULL,
        CONSTRAINT "CK_lf_briefing_suggestions_status" CHECK (
          "status" IN ('pending', 'applied', 'rejected', 'superseded')
        ),
        CONSTRAINT "CK_lf_briefing_suggestions_confidence" CHECK (
          "confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1)
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_briefing_suggestions_job_field"
      ON "leadflow_briefing_suggestions" ("extraction_job_id", "field_path")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_briefing_suggestions_field"
      ON "leadflow_briefing_suggestions" ("tenant_id", "workspace_id", "settings_id", "field_path", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_briefing_suggestions_source_version"
      ON "leadflow_briefing_suggestions" ("source_version_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_briefing_context_snapshots" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "settings_id" uuid NOT NULL,
        "snapshot_kind" character varying(20) NOT NULL,
        "draft_value" jsonb NOT NULL,
        "draft_hash" character varying(64) NOT NULL,
        "schema_version" integer NOT NULL DEFAULT 1,
        "published_version" integer,
        "created_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_briefing_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_briefing_snapshots_settings" FOREIGN KEY ("settings_id")
          REFERENCES "leadflow_client_settings" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CK_lf_briefing_snapshots_kind" CHECK (
          "snapshot_kind" IN ('manual_edit', 'suggestion_applied', 'published')
        ),
        CONSTRAINT "CK_lf_briefing_snapshots_published_version" CHECK (
          "snapshot_kind" <> 'published' OR "published_version" IS NOT NULL
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_briefing_snapshots_published_version"
      ON "leadflow_briefing_context_snapshots" ("settings_id", "published_version")
      WHERE "snapshot_kind" = 'published'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_briefing_snapshots_settings"
      ON "leadflow_briefing_context_snapshots" ("settings_id", "created_at" DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_briefing_suggestion_applications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "settings_id" uuid NOT NULL,
        "suggestion_id" uuid NOT NULL,
        "field_path" character varying(200) NOT NULL,
        "previous_value" jsonb,
        "applied_value" jsonb NOT NULL,
        "resulting_snapshot_id" uuid NOT NULL,
        "applied_by_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_briefing_applications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_briefing_applications_suggestion" FOREIGN KEY ("suggestion_id")
          REFERENCES "leadflow_briefing_suggestions" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_lf_briefing_applications_snapshot" FOREIGN KEY ("resulting_snapshot_id")
          REFERENCES "leadflow_briefing_context_snapshots" ("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_briefing_applications_suggestion"
      ON "leadflow_briefing_suggestion_applications" ("suggestion_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_briefing_applications_field"
      ON "leadflow_briefing_suggestion_applications" ("tenant_id", "workspace_id", "settings_id", "field_path", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "leadflow_briefing_suggestion_applications"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "leadflow_briefing_context_snapshots"');
    await queryRunner.query('DROP TABLE IF EXISTS "leadflow_briefing_suggestions"');
    await queryRunner.query('DROP TABLE IF EXISTS "leadflow_briefing_extraction_jobs"');
    await queryRunner.query(
      'DROP TABLE IF EXISTS "leadflow_briefing_source_versions"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "leadflow_briefing_sources"');
  }
}
