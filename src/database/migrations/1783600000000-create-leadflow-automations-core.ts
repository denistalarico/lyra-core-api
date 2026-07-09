import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLeadflowAutomationsCore1783600000000
  implements MigrationInterface
{
  name = 'CreateLeadflowAutomationsCore1783600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "leadflow_automations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "settings_id" uuid,
        "context_type" character varying(30) NOT NULL DEFAULT 'agency',
        "agency_client_id" uuid,
        "business_mode_key" character varying(80) NOT NULL,
        "recipe_key" character varying(120) NOT NULL,
        "name" character varying(160) NOT NULL,
        "description" text,
        "category" character varying(40) NOT NULL,
        "status" character varying(30) NOT NULL DEFAULT 'draft',
        "trigger_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "condition_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "action_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "message_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "crm_policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "schedule_policy" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "developer_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "webhook_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "readiness" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "published_version_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_by_id" uuid,
        "updated_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leadflow_automations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_automations_settings" FOREIGN KEY ("settings_id")
          REFERENCES "leadflow_client_settings" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_automations_tenant_workspace"
      ON "leadflow_automations" ("tenant_id", "workspace_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_automations_settings_id"
      ON "leadflow_automations" ("settings_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_automations_business_mode_key"
      ON "leadflow_automations" ("business_mode_key")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_automations_recipe_key"
      ON "leadflow_automations" ("recipe_key")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_automations_status"
      ON "leadflow_automations" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_automations_context"
      ON "leadflow_automations" ("tenant_id", "workspace_id", "context_type", "agency_client_id")
    `);

    await queryRunner.query(`
      CREATE TABLE "leadflow_automation_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "automation_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "status" character varying(30) NOT NULL DEFAULT 'published',
        "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leadflow_automation_versions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_automation_versions_automation" FOREIGN KEY ("automation_id")
          REFERENCES "leadflow_automations" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_automation_versions_automation_id"
      ON "leadflow_automation_versions" ("automation_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lf_automation_versions_automation_version"
      ON "leadflow_automation_versions" ("automation_id", "version")
    `);

    await queryRunner.query(`
      ALTER TABLE "leadflow_automations"
      ADD CONSTRAINT "FK_lf_automations_published_version"
      FOREIGN KEY ("published_version_id")
      REFERENCES "leadflow_automation_versions" ("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "leadflow_automations" DROP CONSTRAINT IF EXISTS "FK_lf_automations_published_version"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_automation_versions_automation_version"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_automation_versions_automation_id"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "leadflow_automation_versions"`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lf_automations_context"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lf_automations_status"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_automations_recipe_key"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_automations_business_mode_key"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_automations_settings_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_automations_tenant_workspace"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "leadflow_automations"`);
  }
}
