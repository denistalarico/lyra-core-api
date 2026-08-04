import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Forward-only repair for environments that executed an early revision of
 * 1788500000000 before the review/provenance tables were appended to it.
 * Existing complete installations are unchanged because every statement is
 * idempotent. The migration deliberately has no destructive down operation.
 */
export class ReconcileLeadflowBriefingReviewSchema1789100000000 implements MigrationInterface {
  name = 'ReconcileLeadflowBriefingReviewSchema1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
      ON "leadflow_briefing_suggestions"
        ("tenant_id", "workspace_id", "settings_id", "field_path", "status")
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
      ON "leadflow_briefing_suggestion_applications"
        ("tenant_id", "workspace_id", "settings_id", "field_path", "created_at" DESC)
    `);
  }

  public async down(): Promise<void> {
    // Forward-only reconciliation: these tables may predate this migration.
  }
}
