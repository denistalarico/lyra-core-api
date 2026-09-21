import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeSocialBoostTemplatesByCompany1794720000000
  implements MigrationInterface
{
  name = 'ScopeSocialBoostTemplatesByCompany1794720000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "social_boost_templates" ADD COLUMN IF NOT EXISTS "company_context_id" uuid',
    );
    await queryRunner.query(`
      WITH candidates AS (
        SELECT "tenant_id", "workspace_id", "agency_client_id",
               (array_agg("id" ORDER BY "id"))[1] AS "company_context_id",
               count(*) AS "context_count"
        FROM "agency_client_company_contexts"
        GROUP BY "tenant_id", "workspace_id", "agency_client_id"
      )
      UPDATE "social_boost_templates" AS template
         SET "company_context_id" = candidates."company_context_id"
        FROM candidates
       WHERE template."company_context_id" IS NULL
         AND template."agency_client_id" IS NOT NULL
         AND candidates."tenant_id" = template."tenant_id"
         AND candidates."workspace_id" = template."workspace_id"
         AND candidates."agency_client_id" = template."agency_client_id"
         AND candidates."context_count" = 1
    `);
    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
        ADD CONSTRAINT "CK_social_boost_templates_company_scope"
          CHECK ("company_context_id" IS NULL OR "agency_client_id" IS NOT NULL),
        ADD CONSTRAINT "FK_social_boost_templates_company_context"
          FOREIGN KEY (
            "company_context_id", "tenant_id", "workspace_id", "agency_client_id"
          )
          REFERENCES "agency_client_company_contexts" (
            "id", "tenant_id", "workspace_id", "agency_client_id"
          )
          ON DELETE RESTRICT
    `);

    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_boost_templates_scope"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_boost_templates_client_name"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_boost_templates_client_default"',
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_social_boost_templates_scope"
        ON "social_boost_templates" (
          "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "provider"
        )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_social_boost_templates_company_name"
        ON "social_boost_templates" (
          "tenant_id", "workspace_id", "agency_client_id", "company_context_id", lower("name")
        )
        WHERE "company_context_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_social_boost_templates_company_default"
        ON "social_boost_templates" (
          "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "provider"
        )
        WHERE "company_context_id" IS NOT NULL AND "is_default" = true
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_social_boost_templates_legacy_name"
        ON "social_boost_templates" (
          "tenant_id", "workspace_id", "agency_client_id", lower("name")
        )
        WHERE "agency_client_id" IS NOT NULL AND "company_context_id" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_social_boost_templates_legacy_default"
        ON "social_boost_templates" (
          "tenant_id", "workspace_id", "agency_client_id", "provider"
        )
        WHERE "agency_client_id" IS NOT NULL
          AND "company_context_id" IS NULL
          AND "is_default" = true
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_boost_request_company_scope()
      RETURNS trigger AS $$
      DECLARE
        connection_company uuid;
        template_company uuid;
        publication_company uuid;
        publication_content uuid;
      BEGIN
        SELECT "company_context_id" INTO connection_company
          FROM "social_ad_account_connections"
         WHERE "id" = NEW."connection_id"
           AND "tenant_id" = NEW."tenant_id"
           AND "workspace_id" = NEW."workspace_id"
           AND "agency_client_id" IS NOT DISTINCT FROM NEW."agency_client_id";
        IF NOT FOUND THEN
          RAISE EXCEPTION 'boost account must inherit request scope'
            USING ERRCODE = '23514';
        END IF;

        SELECT "company_context_id" INTO template_company
          FROM "social_boost_templates"
         WHERE "id" = NEW."boost_template_id"
           AND "tenant_id" = NEW."tenant_id"
           AND "workspace_id" = NEW."workspace_id"
           AND "agency_client_id" IS NOT DISTINCT FROM NEW."agency_client_id";
        IF NOT FOUND THEN
          RAISE EXCEPTION 'boost template must inherit request scope'
            USING ERRCODE = '23514';
        END IF;

        SELECT asset."company_context_id", publication."content_item_id"
          INTO publication_company, publication_content
          FROM "social_publications" publication
          JOIN "social_organic_assets" asset ON asset."id" = publication."asset_id"
         WHERE publication."id" = NEW."publication_id"
           AND publication."tenant_id" = NEW."tenant_id"
           AND publication."workspace_id" = NEW."workspace_id"
           AND publication."agency_client_id" IS NOT DISTINCT FROM NEW."agency_client_id";
        IF NOT FOUND OR publication_content IS DISTINCT FROM NEW."content_item_id" THEN
          RAISE EXCEPTION 'boost publication must inherit request scope'
            USING ERRCODE = '23514';
        END IF;

        IF connection_company IS DISTINCT FROM template_company OR
           connection_company IS DISTINCT FROM publication_company THEN
          RAISE EXCEPTION 'boost parents must share the same company scope'
            USING ERRCODE = '23514';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_boost_requests_company_scope"
      BEFORE INSERT OR UPDATE OF
        "tenant_id", "workspace_id", "agency_client_id", "connection_id",
        "publication_id", "content_item_id", "boost_template_id"
      ON "social_boost_requests"
      FOR EACH ROW EXECUTE FUNCTION validate_social_boost_request_company_scope()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_boost_requests_company_scope" ON "social_boost_requests"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS validate_social_boost_request_company_scope()',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_boost_templates_legacy_default"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_boost_templates_legacy_name"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_boost_templates_company_default"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_boost_templates_company_name"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_boost_templates_scope"',
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_social_boost_templates_scope"
        ON "social_boost_templates" (
          "tenant_id", "workspace_id", "agency_client_id", "provider"
        )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_social_boost_templates_client_name"
        ON "social_boost_templates" (
          "tenant_id", "workspace_id", "agency_client_id", lower("name")
        )
        WHERE "agency_client_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_social_boost_templates_client_default"
        ON "social_boost_templates" (
          "tenant_id", "workspace_id", "agency_client_id", "provider"
        )
        WHERE "agency_client_id" IS NOT NULL AND "is_default" = true
    `);
    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
        DROP CONSTRAINT IF EXISTS "FK_social_boost_templates_company_context",
        DROP CONSTRAINT IF EXISTS "CK_social_boost_templates_company_scope",
        DROP COLUMN IF EXISTS "company_context_id"
    `);
  }
}
