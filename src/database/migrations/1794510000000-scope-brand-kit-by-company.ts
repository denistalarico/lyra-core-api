import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeBrandKitByCompany1794510000000 implements MigrationInterface {
  name = 'ScopeBrandKitByCompany1794510000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "company_context_id" uuid',
    );
    await queryRunner.query(`
      WITH candidates AS (
        SELECT "tenant_id", "workspace_id", "agency_client_id",
               (array_agg("id" ORDER BY "id"))[1] AS "company_context_id",
               count(*) AS "context_count"
        FROM "agency_client_company_contexts"
        GROUP BY "tenant_id", "workspace_id", "agency_client_id"
      )
      UPDATE "brand_kits" AS kit
      SET "company_context_id" = candidates."company_context_id"
      FROM candidates
      WHERE kit."company_context_id" IS NULL
        AND kit."agency_client_id" IS NOT NULL
        AND candidates."tenant_id" = kit."tenant_id"
        AND candidates."workspace_id" = kit."workspace_id"
        AND candidates."agency_client_id" = kit."agency_client_id"
        AND candidates."context_count" = 1
    `);
    await queryRunner.query(`
      ALTER TABLE "brand_kits"
        ADD CONSTRAINT "CK_brand_kits_company_scope"
          CHECK ("company_context_id" IS NULL OR "agency_client_id" IS NOT NULL),
        ADD CONSTRAINT "FK_brand_kits_company_context"
          FOREIGN KEY (
            "company_context_id", "tenant_id", "workspace_id", "agency_client_id"
          )
          REFERENCES "agency_client_company_contexts" (
            "id", "tenant_id", "workspace_id", "agency_client_id"
          )
          ON DELETE RESTRICT
    `);

    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_brand_kits_client_scope"',
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_brand_kits_company_scope"
      ON "brand_kits" (
        "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
      )
      WHERE "company_context_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_brand_kits_legacy_scope"
      ON "brand_kits" ("tenant_id", "workspace_id", "agency_client_id")
      WHERE "agency_client_id" IS NOT NULL AND "company_context_id" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_brand_kits_scope"
      ON "brand_kits" (
        "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
      )
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_brand_kit_asset_parent_scope()
      RETURNS trigger AS $$
      DECLARE parent "brand_kits"%ROWTYPE;
      BEGIN
        SELECT * INTO parent FROM "brand_kits" WHERE "id" = NEW."brand_kit_id";
        IF NOT FOUND OR
           parent."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
           parent."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
           parent."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" THEN
          RAISE EXCEPTION 'brand kit asset must inherit the parent kit scope'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_brand_kit_assets_parent_scope"
      BEFORE INSERT OR UPDATE OF
        "brand_kit_id", "tenant_id", "workspace_id", "agency_client_id"
      ON "brand_kit_assets"
      FOR EACH ROW EXECUTE FUNCTION validate_brand_kit_asset_parent_scope()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_brand_kit_assets_parent_scope" ON "brand_kit_assets"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS validate_brand_kit_asset_parent_scope()',
    );
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_brand_kits_scope"');
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_brand_kits_legacy_scope"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_brand_kits_company_scope"',
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_brand_kits_client_scope"
      ON "brand_kits" ("tenant_id", "workspace_id", "agency_client_id")
      WHERE "agency_client_id" IS NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "brand_kits"
        DROP CONSTRAINT IF EXISTS "FK_brand_kits_company_context",
        DROP CONSTRAINT IF EXISTS "CK_brand_kits_company_scope",
        DROP COLUMN IF EXISTS "company_context_id"
    `);
  }
}
