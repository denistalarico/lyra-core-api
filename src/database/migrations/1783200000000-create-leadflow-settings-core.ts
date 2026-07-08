import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLeadflowSettingsCore1783200000000 implements MigrationInterface {
  name = 'CreateLeadflowSettingsCore1783200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "leadflow_business_mode_templates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid,
        "key" character varying(80) NOT NULL,
        "name" character varying(160) NOT NULL,
        "description" text,
        "category" character varying(80),
        "version" integer NOT NULL DEFAULT 1,
        "status" character varying(30) NOT NULL DEFAULT 'active',
        "is_official" boolean NOT NULL DEFAULT true,
        "is_system" boolean NOT NULL DEFAULT true,
        "is_developer_only" boolean NOT NULL DEFAULT false,
        "parent_template_id" uuid,
        "pipeline_template" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "conversion_goals" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "qualification_fields" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "agent_prompt_template" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "client_prompt_schema" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "inbox_rules" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "handoff_rules" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "recommended_apps" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "supported_integrations" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "developer_overrides_schema" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_leadflow_business_mode_templates" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_bmt_parent_template" FOREIGN KEY ("parent_template_id")
          REFERENCES "leadflow_business_mode_templates" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lf_bmt_official_key_version_unique"
      ON "leadflow_business_mode_templates" ("key", "version")
      WHERE tenant_id IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lf_bmt_custom_tenant_key_version_unique"
      ON "leadflow_business_mode_templates" ("tenant_id", "key", "version")
      WHERE tenant_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_bmt_tenant_id"
      ON "leadflow_business_mode_templates" ("tenant_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_bmt_status"
      ON "leadflow_business_mode_templates" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_bmt_is_official"
      ON "leadflow_business_mode_templates" ("is_official")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_bmt_key"
      ON "leadflow_business_mode_templates" ("key")
    `);

    await queryRunner.query(`
      CREATE TABLE "leadflow_client_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid NOT NULL,
        "managed_tenant_id" uuid,
        "business_mode_key" character varying(80) NOT NULL,
        "business_mode_template_id" uuid,
        "plan_key" character varying(80),
        "status" character varying(30) NOT NULL DEFAULT 'draft',
        "developer_mode_enabled" boolean NOT NULL DEFAULT false,
        "enabled_apps" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "enabled_integrations" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "permissions_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "branding_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "agent_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "client_prompt_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "inbox_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "inbox_overrides" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "handoff_overrides" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "leads_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "pipeline_ref" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "business_mode_overrides" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "developer_overrides" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_by_id" uuid,
        "updated_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_leadflow_client_settings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_lf_client_settings_tenant_workspace_client"
          UNIQUE ("tenant_id", "workspace_id", "agency_client_id"),
        CONSTRAINT "FK_lf_client_settings_agency_client" FOREIGN KEY ("agency_client_id")
          REFERENCES "agency_clients" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_lf_client_settings_business_mode_template"
          FOREIGN KEY ("business_mode_template_id")
          REFERENCES "leadflow_business_mode_templates" ("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_client_settings_managed_tenant_id"
      ON "leadflow_client_settings" ("managed_tenant_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_client_settings_business_mode_key"
      ON "leadflow_client_settings" ("business_mode_key")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_client_settings_template_id"
      ON "leadflow_client_settings" ("business_mode_template_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_client_settings_status"
      ON "leadflow_client_settings" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_client_settings_tenant_workspace"
      ON "leadflow_client_settings" ("tenant_id", "workspace_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_client_settings_tenant_workspace"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_client_settings_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_client_settings_template_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_client_settings_business_mode_key"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_client_settings_managed_tenant_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "leadflow_client_settings"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lf_bmt_key"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lf_bmt_is_official"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lf_bmt_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lf_bmt_tenant_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_bmt_custom_tenant_key_version_unique"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_bmt_official_key_version_unique"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "leadflow_business_mode_templates"`,
    );
  }
}
