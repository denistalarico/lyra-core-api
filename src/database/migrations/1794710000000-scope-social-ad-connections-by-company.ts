import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeSocialAdConnectionsByCompany1794710000000
  implements MigrationInterface
{
  name = 'ScopeSocialAdConnectionsByCompany1794710000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "social_ad_account_connections" ADD COLUMN IF NOT EXISTS "company_context_id" uuid',
    );
    await queryRunner.query(`
      WITH candidates AS (
        SELECT "tenant_id", "workspace_id", "agency_client_id",
               (array_agg("id" ORDER BY "id"))[1] AS "company_context_id",
               count(*) AS "context_count"
        FROM "agency_client_company_contexts"
        GROUP BY "tenant_id", "workspace_id", "agency_client_id"
      )
      UPDATE "social_ad_account_connections" AS connection
         SET "company_context_id" = candidates."company_context_id"
        FROM candidates
       WHERE connection."company_context_id" IS NULL
         AND connection."agency_client_id" IS NOT NULL
         AND candidates."tenant_id" = connection."tenant_id"
         AND candidates."workspace_id" = connection."workspace_id"
         AND candidates."agency_client_id" = connection."agency_client_id"
         AND candidates."context_count" = 1
    `);
    await queryRunner.query(`
      ALTER TABLE "social_ad_account_connections"
        ADD CONSTRAINT "CK_social_ad_account_connections_company_scope"
          CHECK ("company_context_id" IS NULL OR "agency_client_id" IS NOT NULL),
        ADD CONSTRAINT "FK_social_ad_account_connections_company_context"
          FOREIGN KEY (
            "company_context_id", "tenant_id", "workspace_id", "agency_client_id"
          )
          REFERENCES "agency_client_company_contexts" (
            "id", "tenant_id", "workspace_id", "agency_client_id"
          )
          ON DELETE RESTRICT
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_ad_account_connections_context"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_ad_account_connections_account"',
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_social_ad_account_connections_context"
        ON "social_ad_account_connections" (
          "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
        )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_social_ad_account_connections_company_account"
        ON "social_ad_account_connections" (
          "tenant_id", "workspace_id", "agency_client_id", "company_context_id",
          "provider", "external_account_id"
        )
        WHERE "company_context_id" IS NOT NULL
          AND "external_account_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_social_ad_account_connections_legacy_account"
        ON "social_ad_account_connections" (
          "tenant_id", "workspace_id", "agency_client_id", "provider", "external_account_id"
        )
        WHERE "agency_client_id" IS NOT NULL
          AND "company_context_id" IS NULL
          AND "external_account_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_social_ad_account_connections_agency_account"
        ON "social_ad_account_connections" (
          "tenant_id", "workspace_id", "provider", "external_account_id"
        )
        WHERE "agency_client_id" IS NULL
          AND "company_context_id" IS NULL
          AND "external_account_id" IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_ad_account_connections_agency_account"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_ad_account_connections_legacy_account"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_ad_account_connections_company_account"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_ad_account_connections_context"',
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_social_ad_account_connections_context"
        ON "social_ad_account_connections" ("tenant_id", "workspace_id", "agency_client_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_social_ad_account_connections_account"
        ON "social_ad_account_connections" (
          "tenant_id", "workspace_id", "provider", "external_account_id"
        )
    `);
    await queryRunner.query(`
      ALTER TABLE "social_ad_account_connections"
        DROP CONSTRAINT IF EXISTS "FK_social_ad_account_connections_company_context",
        DROP CONSTRAINT IF EXISTS "CK_social_ad_account_connections_company_scope",
        DROP COLUMN IF EXISTS "company_context_id"
    `);
  }
}
