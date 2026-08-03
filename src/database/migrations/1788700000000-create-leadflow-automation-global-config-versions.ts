import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Append-only defaults history per LeadFlow Settings context. A new row is
 * created for every saved version; published automation snapshots remain
 * self-contained and never depend on a mutable settings JSON document.
 */
export class CreateLeadflowAutomationGlobalConfigVersions1788700000000 implements MigrationInterface {
  name = 'CreateLeadflowAutomationGlobalConfigVersions1788700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_automation_global_config_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "settings_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_by_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_automation_global_config_versions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lf_automation_global_config_settings" FOREIGN KEY ("settings_id")
          REFERENCES "leadflow_client_settings" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_lf_automation_global_config_settings_version"
      ON "leadflow_automation_global_config_versions" ("settings_id", "version")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_automation_global_config_tenant_workspace"
      ON "leadflow_automation_global_config_versions" ("tenant_id", "workspace_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_automation_global_config_tenant_workspace"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_automation_global_config_settings_version"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "leadflow_automation_global_config_versions"`,
    );
  }
}
