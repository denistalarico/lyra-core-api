import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateGovernedStageTransitions1784580000000 implements MigrationInterface {
  name = 'CreateGovernedStageTransitions1784580000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "crm_stages"
      ADD COLUMN IF NOT EXISTS "operation_mode" varchar(24) NOT NULL DEFAULT 'hybrid'
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_stages"
      ADD CONSTRAINT "chk_crm_stages_operation_mode"
      CHECK ("operation_mode" IN ('ai_managed', 'human_managed', 'hybrid'))
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_stages"
      ADD CONSTRAINT "uq_crm_stages_scope_pipeline_id"
      UNIQUE ("tenant_id", "workspace_id", "pipeline_id", "id")
    `);

    await queryRunner.query(`
      CREATE TABLE "crm_stage_transition_policies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "pipeline_id" uuid NOT NULL,
        "from_stage_id" uuid NOT NULL,
        "to_stage_id" uuid NOT NULL,
        "allowed_actors" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "required_fields" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "condition_contract" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "reason_codes" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "ai_guidance" text,
        "status" varchar(24) NOT NULL DEFAULT 'draft',
        "version" integer NOT NULL,
        "published_at" timestamptz,
        "published_by_id" uuid,
        "created_by_id" uuid,
        "superseded_by_policy_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "pk_crm_stage_transition_policies" PRIMARY KEY ("id"),
        CONSTRAINT "chk_crm_transition_distinct_stages" CHECK ("from_stage_id" <> "to_stage_id"),
        CONSTRAINT "chk_crm_transition_version" CHECK ("version" > 0),
        CONSTRAINT "chk_crm_transition_status" CHECK ("status" IN ('draft', 'published', 'inactive')),
        CONSTRAINT "chk_crm_transition_allowed_actors_array" CHECK (
          jsonb_typeof("allowed_actors") = 'array'
          AND jsonb_array_length("allowed_actors") > 0
          AND "allowed_actors" <@ '["human", "ai", "automation", "system"]'::jsonb
        ),
        CONSTRAINT "chk_crm_transition_required_fields_array" CHECK (jsonb_typeof("required_fields") = 'array'),
        CONSTRAINT "chk_crm_transition_reason_codes_array" CHECK (jsonb_typeof("reason_codes") = 'array' AND jsonb_array_length("reason_codes") > 0),
        CONSTRAINT "chk_crm_transition_condition_object" CHECK (jsonb_typeof("condition_contract") = 'object'),
        CONSTRAINT "uq_crm_transition_edge_version" UNIQUE ("tenant_id", "workspace_id", "pipeline_id", "from_stage_id", "to_stage_id", "version"),
        CONSTRAINT "fk_crm_transition_pipeline_scope" FOREIGN KEY ("tenant_id", "workspace_id", "pipeline_id")
          REFERENCES "crm_pipelines" ("tenant_id", "workspace_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "fk_crm_transition_from_stage_scope" FOREIGN KEY ("tenant_id", "workspace_id", "pipeline_id", "from_stage_id")
          REFERENCES "crm_stages" ("tenant_id", "workspace_id", "pipeline_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "fk_crm_transition_to_stage_scope" FOREIGN KEY ("tenant_id", "workspace_id", "pipeline_id", "to_stage_id")
          REFERENCES "crm_stages" ("tenant_id", "workspace_id", "pipeline_id", "id") ON DELETE RESTRICT,
        CONSTRAINT "fk_crm_transition_superseded_by" FOREIGN KEY ("superseded_by_policy_id")
          REFERENCES "crm_stage_transition_policies" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_crm_transition_current_draft"
      ON "crm_stage_transition_policies" ("tenant_id", "workspace_id", "pipeline_id", "from_stage_id", "to_stage_id")
      WHERE "status" = 'draft' AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_crm_transition_current_published"
      ON "crm_stage_transition_policies" ("tenant_id", "workspace_id", "pipeline_id", "from_stage_id", "to_stage_id")
      WHERE "status" = 'published' AND "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_crm_transition_pipeline_status"
      ON "crm_stage_transition_policies" ("tenant_id", "workspace_id", "pipeline_id", "status")
      WHERE "deleted_at" IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "crm_stage_transition_policies"`,
    );
    await queryRunner.query(`
      ALTER TABLE "crm_stages"
      DROP CONSTRAINT IF EXISTS "uq_crm_stages_scope_pipeline_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_stages"
      DROP CONSTRAINT IF EXISTS "chk_crm_stages_operation_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_stages"
      DROP COLUMN IF EXISTS "operation_mode"
    `);
  }
}
