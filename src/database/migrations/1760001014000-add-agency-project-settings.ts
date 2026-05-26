import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgencyProjectSettings1760001014000 implements MigrationInterface {
  name = 'AddAgencyProjectSettings1760001014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_projects"
      ADD COLUMN IF NOT EXISTS "marker_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS "is_public_page_enabled" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "public_page_password" character varying(120)
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_project_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "project_markers" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "task_markers" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "task_types" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "task_execution_mode" character varying(24) NOT NULL DEFAULT 'hybrid',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_project_settings" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_project_user_preferences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "overview_column_order" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "project_board" jsonb NOT NULL DEFAULT '{"foldedStageIds":[],"pinnedCardsByStage":{}}'::jsonb,
        "workspace_task_board" jsonb NOT NULL DEFAULT '{"foldedStageIds":[],"pinnedCardsByStage":{}}'::jsonb,
        "personal_task_board" jsonb NOT NULL DEFAULT '{"foldedStageIds":[],"pinnedCardsByStage":{}}'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_project_user_preferences" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_agency_project_settings_workspace"
      ON "agency_project_settings" ("tenant_id", "workspace_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_agency_project_user_preferences_user"
      ON "agency_project_user_preferences" ("tenant_id", "workspace_id", "user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_agency_project_user_preferences_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_agency_project_settings_workspace"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_project_user_preferences"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_project_settings"`);
    await queryRunner.query(`
      ALTER TABLE "agency_projects"
      DROP COLUMN IF EXISTS "public_page_password",
      DROP COLUMN IF EXISTS "is_public_page_enabled",
      DROP COLUMN IF EXISTS "marker_ids"
    `);
  }
}
