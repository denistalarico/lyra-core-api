import type { MigrationInterface, QueryRunner } from 'typeorm';

const ROOTS = ['social_creative_folders', 'social_creative_assets'] as const;

export class ScopeCreativeStudioByCompany1794520000000 implements MigrationInterface {
  name = 'ScopeCreativeStudioByCompany1794520000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ROOTS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "company_context_id" uuid`,
      );
      await queryRunner.query(`
        WITH candidates AS (
          SELECT "tenant_id", "workspace_id", "agency_client_id",
                 (array_agg("id" ORDER BY "id"))[1] AS "company_context_id",
                 count(*) AS "context_count"
          FROM "agency_client_company_contexts"
          GROUP BY "tenant_id", "workspace_id", "agency_client_id"
        )
        UPDATE "${table}" AS root
        SET "company_context_id" = candidates."company_context_id"
        FROM candidates
        WHERE root."company_context_id" IS NULL
          AND root."agency_client_id" IS NOT NULL
          AND candidates."tenant_id" = root."tenant_id"
          AND candidates."workspace_id" = root."workspace_id"
          AND candidates."agency_client_id" = root."agency_client_id"
          AND candidates."context_count" = 1
      `);
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "CK_${table}_company_scope"
            CHECK ("company_context_id" IS NULL OR "agency_client_id" IS NOT NULL),
          ADD CONSTRAINT "FK_${table}_company_context"
            FOREIGN KEY (
              "company_context_id", "tenant_id", "workspace_id", "agency_client_id"
            )
            REFERENCES "agency_client_company_contexts" (
              "id", "tenant_id", "workspace_id", "agency_client_id"
            )
            ON DELETE RESTRICT
      `);
    }

    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_creative_folders_scope"',
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_social_creative_folders_scope"
      ON "social_creative_folders" (
        "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
      )
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_creative_assets_scope_created"',
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_social_creative_assets_scope_created"
      ON "social_creative_assets" (
        "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "created_at" DESC
      )
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_creative_folder_parent_scope()
      RETURNS trigger AS $$
      DECLARE parent "social_creative_folders"%ROWTYPE;
      BEGIN
        IF NEW."parent_id" IS NULL THEN RETURN NEW; END IF;
        SELECT * INTO parent FROM "social_creative_folders" WHERE "id" = NEW."parent_id";
        IF NOT FOUND OR
           parent."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
           parent."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
           parent."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
           parent."company_context_id" IS DISTINCT FROM NEW."company_context_id" THEN
          RAISE EXCEPTION 'creative folder parent must use the same company scope'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_creative_folders_parent_scope"
      BEFORE INSERT OR UPDATE OF
        "parent_id", "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
      ON "social_creative_folders"
      FOR EACH ROW EXECUTE FUNCTION validate_social_creative_folder_parent_scope()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_creative_asset_relations_scope()
      RETURNS trigger AS $$
      DECLARE folder "social_creative_folders"%ROWTYPE;
      DECLARE plan_scope record;
      BEGIN
        IF NEW."folder_id" IS NOT NULL THEN
          SELECT * INTO folder FROM "social_creative_folders" WHERE "id" = NEW."folder_id";
          IF NOT FOUND OR
             folder."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
             folder."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
             folder."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
             folder."company_context_id" IS DISTINCT FROM NEW."company_context_id" THEN
            RAISE EXCEPTION 'creative asset folder must use the same company scope'
              USING ERRCODE = '23514';
          END IF;
        END IF;

        IF NEW."content_item_id" IS NOT NULL THEN
          SELECT plan."tenant_id", plan."workspace_id", plan."agency_client_id",
                 plan."company_context_id"
          INTO plan_scope
          FROM "social_content_items" item
          INNER JOIN "social_plans" plan ON plan."id" = item."plan_id"
          WHERE item."id" = NEW."content_item_id";
          IF NOT FOUND OR
             plan_scope."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
             plan_scope."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
             plan_scope."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
             plan_scope."company_context_id" IS DISTINCT FROM NEW."company_context_id" THEN
            RAISE EXCEPTION 'creative asset content must use the same company scope'
              USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_creative_assets_relations_scope"
      BEFORE INSERT OR UPDATE OF
        "folder_id", "content_item_id", "tenant_id", "workspace_id",
        "agency_client_id", "company_context_id"
      ON "social_creative_assets"
      FOR EACH ROW EXECUTE FUNCTION validate_social_creative_asset_relations_scope()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_assets_relations_scope" ON "social_creative_assets"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS validate_social_creative_asset_relations_scope()',
    );
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_folders_parent_scope" ON "social_creative_folders"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS validate_social_creative_folder_parent_scope()',
    );

    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_creative_assets_scope_created"',
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_social_creative_assets_scope_created"
      ON "social_creative_assets" (
        "tenant_id", "workspace_id", "agency_client_id", "created_at" DESC
      )
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_creative_folders_scope"',
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_social_creative_folders_scope"
      ON "social_creative_folders" ("tenant_id", "workspace_id", "agency_client_id")
    `);

    for (const table of [...ROOTS].reverse()) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
          DROP CONSTRAINT IF EXISTS "FK_${table}_company_context",
          DROP CONSTRAINT IF EXISTS "CK_${table}_company_scope",
          DROP COLUMN IF EXISTS "company_context_id"
      `);
    }
  }
}
