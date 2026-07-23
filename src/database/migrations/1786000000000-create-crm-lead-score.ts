import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Structural only.
 *
 * No score is assigned here. Backfilling values inside a migration would invent
 * history: the rows would carry a `calculated_at` that never corresponded to a
 * real calculation, and the snapshots the Analytics work depends on would open
 * with fabricated entries. Existing opportunities are scored by the explicit,
 * resumable backfill service instead.
 */
export class CreateCrmLeadScore1786000000000 implements MigrationInterface {
  name = 'CreateCrmLeadScore1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_lead_score_states" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "opportunity_id" uuid NOT NULL,
        "score" integer NOT NULL,
        "band" varchar(16) NOT NULL,
        "policy_version" varchar(80) NOT NULL,
        "feature_schema_version" varchar(80) NOT NULL,
        "max_achievable" integer NOT NULL,
        "breakdown" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "calculation_reason" varchar(40) NOT NULL,
        "calculated_at" timestamptz NOT NULL,
        "last_snapshot_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_crm_lead_score_states" PRIMARY KEY ("id"),
        CONSTRAINT "chk_crm_lead_score_states_range"
          CHECK ("score" >= 0 AND "score" <= 100),
        CONSTRAINT "chk_crm_lead_score_states_band"
          CHECK ("band" IN ('cold', 'warm', 'hot')),
        CONSTRAINT "chk_crm_lead_score_states_breakdown"
          CHECK (jsonb_typeof("breakdown") = 'array')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_crm_lead_score_states_opportunity"
      ON "crm_lead_score_states" ("opportunity_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_crm_lead_score_states_scope_band"
      ON "crm_lead_score_states" ("tenant_id", "workspace_id", "band")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_lead_score_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "opportunity_id" uuid NOT NULL,
        "score" integer NOT NULL,
        "band" varchar(16) NOT NULL,
        "previous_score" integer,
        "previous_band" varchar(16),
        "policy_version" varchar(80) NOT NULL,
        "feature_schema_version" varchar(80) NOT NULL,
        "max_achievable" integer NOT NULL,
        "features" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "breakdown" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "source_event_id" uuid,
        "source_event_name" varchar(120),
        "correlation_id" uuid,
        "causation_id" uuid,
        "calculation_reason" varchar(40) NOT NULL,
        "opportunity_row_version" integer,
        "feature_query_count" integer NOT NULL DEFAULT 0,
        "feature_duration_ms" integer NOT NULL DEFAULT 0,
        "idempotency_key" varchar(180) NOT NULL,
        "calculated_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_crm_lead_score_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "chk_crm_lead_score_snapshots_range"
          CHECK ("score" >= 0 AND "score" <= 100),
        CONSTRAINT "chk_crm_lead_score_snapshots_band"
          CHECK ("band" IN ('cold', 'warm', 'hot')),
        CONSTRAINT "chk_crm_lead_score_snapshots_features"
          CHECK (jsonb_typeof("features") = 'object'),
        CONSTRAINT "chk_crm_lead_score_snapshots_breakdown"
          CHECK (jsonb_typeof("breakdown") = 'array')
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_crm_lead_score_snapshots_idempotency"
      ON "crm_lead_score_snapshots" ("idempotency_key")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_crm_lead_score_snapshots_opportunity"
      ON "crm_lead_score_snapshots" ("opportunity_id", "calculated_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_crm_lead_score_snapshots_scope"
      ON "crm_lead_score_snapshots" ("tenant_id", "workspace_id", "calculated_at" DESC)
    `);

    // History is append-only. Enforced in the database so a future code path
    // cannot quietly rewrite what a score was at a past moment.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "crm_lead_score_snapshots_append_only"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'crm_lead_score_snapshots is append-only';
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_crm_lead_score_snapshots_append_only"
      BEFORE UPDATE OR DELETE ON "crm_lead_score_snapshots"
      FOR EACH ROW EXECUTE FUNCTION "crm_lead_score_snapshots_append_only"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "trg_crm_lead_score_snapshots_append_only" ON "crm_lead_score_snapshots"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS "crm_lead_score_snapshots_append_only"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "crm_lead_score_snapshots"');
    await queryRunner.query('DROP TABLE IF EXISTS "crm_lead_score_states"');
  }
}
