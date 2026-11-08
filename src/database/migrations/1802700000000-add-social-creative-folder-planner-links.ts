import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One Studio folder per plan and one subfolder per content item. Files already
 * linked to the Planner and still loose at the library root move into them; a
 * file somebody already filed in a folder stays where it is.
 */
export class AddSocialCreativeFolderPlannerLinks1802700000000 implements MigrationInterface {
  name = 'AddSocialCreativeFolderPlannerLinks1802700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_creative_folders"
        ADD COLUMN IF NOT EXISTS "social_plan_id" uuid
          REFERENCES "social_plans" ("id") ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS "content_item_id" uuid
          REFERENCES "social_content_items" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_creative_folders_plan" ON "social_creative_folders" ("social_plan_id") WHERE "social_plan_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_creative_folders_content_item" ON "social_creative_folders" ("content_item_id") WHERE "content_item_id" IS NOT NULL`,
    );

    const looseLinkedAssets = `
      FROM "social_creative_assets" a
      JOIN "social_content_items" i ON i."id" = a."content_item_id" AND i."deleted_at" IS NULL
      JOIN "social_plans" p ON p."id" = i."plan_id" AND p."deleted_at" IS NULL
      WHERE a."folder_id" IS NULL
        AND a."trashed_at" IS NULL
        AND a."deleted_at" IS NULL
        AND a."tenant_id" = p."tenant_id"
        AND a."workspace_id" = p."workspace_id"
        AND a."agency_client_id" IS NOT DISTINCT FROM p."agency_client_id"
        AND a."company_context_id" IS NOT DISTINCT FROM p."company_context_id"`;

    await queryRunner.query(`
      INSERT INTO "social_creative_folders"
        ("tenant_id", "workspace_id", "agency_client_id", "company_context_id", "name", "social_plan_id")
      SELECT DISTINCT ON (p."id")
        a."tenant_id", a."workspace_id", a."agency_client_id", a."company_context_id", left(p."title", 160), p."id"
      ${looseLinkedAssets}
      ORDER BY p."id"
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "social_creative_folders"
        ("tenant_id", "workspace_id", "agency_client_id", "company_context_id", "name", "parent_id", "content_item_id")
      SELECT DISTINCT ON (i."id")
        a."tenant_id", a."workspace_id", a."agency_client_id", a."company_context_id",
        left(CASE WHEN i."planned_date" IS NULL THEN i."title"
          ELSE to_char(i."planned_date", 'YYYY-MM-DD') || ' · ' || i."title" END, 160),
        f."id", i."id"
      ${looseLinkedAssets.replace(
        'WHERE a."folder_id" IS NULL',
        'JOIN "social_creative_folders" f ON f."social_plan_id" = p."id" WHERE a."folder_id" IS NULL',
      )}
      ORDER BY i."id"
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE "social_creative_assets" a
      SET "folder_id" = f."id"
      FROM "social_creative_folders" f
      WHERE f."content_item_id" = a."content_item_id"
        AND a."folder_id" IS NULL
        AND a."trashed_at" IS NULL
        AND a."deleted_at" IS NULL
        AND a."tenant_id" = f."tenant_id"
        AND a."workspace_id" = f."workspace_id"
        AND a."agency_client_id" IS NOT DISTINCT FROM f."agency_client_id"
        AND a."company_context_id" IS NOT DISTINCT FROM f."company_context_id"
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "social_creative_assets" SET "folder_id" = NULL
      WHERE "folder_id" IN (
        SELECT "id" FROM "social_creative_folders"
        WHERE "social_plan_id" IS NOT NULL OR "content_item_id" IS NOT NULL
      )
    `);
    await queryRunner.query(
      `DELETE FROM "social_creative_folders" WHERE "content_item_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `DELETE FROM "social_creative_folders" WHERE "social_plan_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_social_creative_folders_content_item"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_social_creative_folders_plan"`,
    );
    await queryRunner.query(`
      ALTER TABLE "social_creative_folders"
        DROP COLUMN IF EXISTS "content_item_id",
        DROP COLUMN IF EXISTS "social_plan_id"
    `);
  }
}
