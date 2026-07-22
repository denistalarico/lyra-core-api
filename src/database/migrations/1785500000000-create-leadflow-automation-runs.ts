import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Observability substrate for LeadFlow Automations: runs and per-action
 * attempts.
 *
 * Created before the execution engine on purpose. The shape of what gets
 * recorded is a contract decision, and settling it now means the engine has a
 * defined place to report to instead of growing its own ad-hoc log. Until then
 * only dry-runs populate these tables.
 *
 * The partial unique index on `idempotency_key` is what makes a retry safe: the
 * same trigger can never produce a second run for the same tenant/workspace.
 */
export class CreateLeadflowAutomationRuns1785500000000 implements MigrationInterface {
  name = 'CreateLeadflowAutomationRuns1785500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_automation_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "automation_id" uuid NOT NULL,
        "automation_version_id" uuid,
        "recipe_key" character varying(120) NOT NULL,
        "template_version" integer NOT NULL DEFAULT 1,
        "mode" character varying(20) NOT NULL DEFAULT 'dry_run',
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "skip_reason" character varying(60),
        "trigger_type" character varying(80) NOT NULL,
        "trigger_kind" character varying(20) NOT NULL,
        "source_event_id" uuid,
        "source_event_name" character varying(120),
        "correlation_id" uuid,
        "causation_id" uuid,
        "idempotency_key" character varying(180),
        "input_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "result" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "error_code" character varying(80),
        "error_message" text,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "scheduled_at" timestamptz,
        "started_at" timestamptz,
        "finished_at" timestamptz,
        "created_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leadflow_automation_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_runs_automation" FOREIGN KEY ("automation_id")
          REFERENCES "leadflow_automations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_runs_tenant_workspace"
      ON "leadflow_automation_runs" ("tenant_id", "workspace_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_runs_automation"
      ON "leadflow_automation_runs" ("automation_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_runs_status"
      ON "leadflow_automation_runs" ("tenant_id", "workspace_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_runs_mode"
      ON "leadflow_automation_runs" ("automation_id", "mode", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_runs_idempotency"
      ON "leadflow_automation_runs" ("tenant_id", "workspace_id", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_automation_run_attempts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "attempt_number" integer NOT NULL DEFAULT 1,
        "action_key" character varying(60) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'simulated',
        "error_class" character varying(20),
        "error_code" character varying(80),
        "error_message" text,
        "effect_requested" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "effect_confirmed" boolean NOT NULL DEFAULT false,
        "duration_ms" integer,
        "started_at" timestamptz,
        "finished_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leadflow_automation_run_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_run_attempts_run" FOREIGN KEY ("run_id")
          REFERENCES "leadflow_automation_runs"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_run_attempts_run"
      ON "leadflow_automation_run_attempts" ("run_id", "attempt_number")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_run_attempts_tenant_workspace"
      ON "leadflow_automation_run_attempts" ("tenant_id", "workspace_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "leadflow_automation_run_attempts"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "leadflow_automation_runs"`);
  }
}
