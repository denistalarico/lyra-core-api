import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSocialCreativeRestoreAndRetention1802800000000 implements MigrationInterface {
  name = 'AddSocialCreativeRestoreAndRetention1802800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_creative_assets"
        ADD COLUMN IF NOT EXISTS "restore_folder_id" uuid,
        ADD COLUMN IF NOT EXISTS "restored_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "purge_after" timestamptz
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_creative_assets_planner_uploads" ON "social_creative_assets" ("id") WHERE "source_type" = 'planner_upload' AND "trashed_at" IS NULL AND "deleted_at" IS NULL AND "restored_at" IS NULL`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_creative_studio_settings" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "company_context_id" uuid,
        "planner_upload_retention_days" smallint NOT NULL DEFAULT 30,
        "updated_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_social_creative_studio_settings_retention"
          CHECK ("planner_upload_retention_days" IN (0, 7, 15, 30))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_creative_studio_settings_scope"
      ON "social_creative_studio_settings" (
        "tenant_id", "workspace_id",
        COALESCE("agency_client_id", '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE("company_context_id", '00000000-0000-0000-0000-000000000000'::uuid)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_creative_studio_settings"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_social_creative_assets_planner_uploads"`,
    );
    await queryRunner.query(`
      ALTER TABLE "social_creative_assets"
        DROP COLUMN IF EXISTS "purge_after",
        DROP COLUMN IF EXISTS "restored_at",
        DROP COLUMN IF EXISTS "restore_folder_id"
    `);
  }
}
