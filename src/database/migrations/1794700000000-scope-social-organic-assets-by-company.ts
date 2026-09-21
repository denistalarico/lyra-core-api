import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeSocialOrganicAssetsByCompany1794700000000
  implements MigrationInterface
{
  name = 'ScopeSocialOrganicAssetsByCompany1794700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "social_organic_assets" ADD COLUMN IF NOT EXISTS "company_context_id" uuid',
    );
    await queryRunner.query(`
      WITH candidates AS (
        SELECT "tenant_id", "workspace_id", "agency_client_id",
               (array_agg("id" ORDER BY "id"))[1] AS "company_context_id",
               count(*) AS "context_count"
        FROM "agency_client_company_contexts"
        GROUP BY "tenant_id", "workspace_id", "agency_client_id"
      )
      UPDATE "social_organic_assets" AS asset
         SET "company_context_id" = candidates."company_context_id"
        FROM candidates
       WHERE asset."company_context_id" IS NULL
         AND asset."agency_client_id" IS NOT NULL
         AND candidates."tenant_id" = asset."tenant_id"
         AND candidates."workspace_id" = asset."workspace_id"
         AND candidates."agency_client_id" = asset."agency_client_id"
         AND candidates."context_count" = 1
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_assets"
        ADD CONSTRAINT "CK_social_organic_assets_company_scope"
          CHECK ("company_context_id" IS NULL OR "agency_client_id" IS NOT NULL),
        ADD CONSTRAINT "FK_social_organic_assets_company_context"
          FOREIGN KEY (
            "company_context_id", "tenant_id", "workspace_id", "agency_client_id"
          )
          REFERENCES "agency_client_company_contexts" (
            "id", "tenant_id", "workspace_id", "agency_client_id"
          )
          ON DELETE RESTRICT
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_organic_assets_context"',
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_social_organic_assets_context"
        ON "social_organic_assets" (
          "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
        )
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_publication_company_scope()
      RETURNS trigger AS $$
      DECLARE
        asset_scope record;
        plan_scope record;
        destination_content_id uuid;
      BEGIN
        SELECT "tenant_id", "workspace_id", "agency_client_id",
               "company_context_id", "connection_id", "provider",
               "external_asset_id"
          INTO asset_scope
          FROM "social_organic_assets"
         WHERE "id" = NEW."asset_id";

        IF NOT FOUND THEN
          RAISE EXCEPTION 'publication asset must exist in its scope'
            USING ERRCODE = '23514';
        END IF;

        SELECT plan."tenant_id", plan."workspace_id", plan."agency_client_id",
               plan."company_context_id"
          INTO plan_scope
          FROM "social_content_items" item
         JOIN "social_plans" plan ON plan."id" = item."plan_id"
         WHERE item."id" = NEW."content_item_id";

        IF NOT FOUND THEN
          RAISE EXCEPTION 'publication content must belong to a scoped plan'
            USING ERRCODE = '23514';
        END IF;

        IF
           asset_scope."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
           asset_scope."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
           asset_scope."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
           asset_scope."connection_id" IS DISTINCT FROM NEW."connection_id" OR
           asset_scope."provider" IS DISTINCT FROM NEW."provider" OR
           asset_scope."external_asset_id" IS DISTINCT FROM NEW."external_asset_id" OR
           plan_scope."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
           plan_scope."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
           plan_scope."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
           plan_scope."company_context_id" IS DISTINCT FROM asset_scope."company_context_id" THEN
          RAISE EXCEPTION 'publication parents must share the same company scope'
            USING ERRCODE = '23514';
        END IF;

        IF NEW."destination_id" IS NOT NULL THEN
          SELECT "content_item_id" INTO destination_content_id
            FROM "social_content_destinations"
           WHERE "id" = NEW."destination_id";
          IF destination_content_id IS DISTINCT FROM NEW."content_item_id" THEN
            RAISE EXCEPTION 'publication destination must belong to its content item'
              USING ERRCODE = '23514';
          END IF;
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_publications_company_scope"
      BEFORE INSERT OR UPDATE OF
        "tenant_id", "workspace_id", "agency_client_id", "content_item_id",
        "destination_id", "provider", "connection_id", "asset_id",
        "external_asset_id"
      ON "social_publications"
      FOR EACH ROW EXECUTE FUNCTION validate_social_publication_company_scope()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_publications_company_scope" ON "social_publications"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS validate_social_publication_company_scope()',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_organic_assets_context"',
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_social_organic_assets_context"
        ON "social_organic_assets" ("tenant_id", "workspace_id", "agency_client_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "social_organic_assets"
        DROP CONSTRAINT IF EXISTS "FK_social_organic_assets_company_context",
        DROP CONSTRAINT IF EXISTS "CK_social_organic_assets_company_scope",
        DROP COLUMN IF EXISTS "company_context_id"
    `);
  }
}
