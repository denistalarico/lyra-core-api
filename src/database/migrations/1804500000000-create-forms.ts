import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Forms addon F1 (2026-11-17): forms + submissions.
 * Plan: docs/sprints/forms-addon-implementation-plan-2026-11-17.md (§4).
 * E-mail (F4) and fiscal (F5) tables come in their own migrations.
 */
export class CreateForms1804500000000 implements MigrationInterface {
  name = 'CreateForms1804500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "forms" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid NULL,
        "company_context_id" uuid NULL,
        "type" varchar(32) NOT NULL,
        "name" varchar(160) NOT NULL,
        "description" text NULL,
        "status" varchar(16) NOT NULL DEFAULT 'draft',
        "public_key" varchar(40) NOT NULL,
        "schema_version" int NOT NULL DEFAULT 1,
        "fields" jsonb NOT NULL DEFAULT '{"fields":[]}'::jsonb,
        "presentation" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "tracking" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "destination" jsonb NOT NULL,
        "security" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "after_submit" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_by_user_id" uuid NULL,
        "published_at" timestamptz NULL,
        "archived_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_forms_public_key" UNIQUE ("public_key"),
        CONSTRAINT "chk_forms_type" CHECK ("type" IN ('lead_capture', 'fiscal_intake')),
        CONSTRAINT "chk_forms_status" CHECK ("status" IN ('draft', 'active', 'inactive', 'archived')),
        CONSTRAINT "chk_forms_company_scope" CHECK (
          ("agency_client_id" IS NULL AND "company_context_id" IS NULL)
          OR ("agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_forms_scope_status"
        ON "forms" ("tenant_id", "workspace_id", "status")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "form_submissions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid NULL,
        "company_context_id" uuid NULL,
        "form_id" uuid NOT NULL REFERENCES "forms" ("id") ON DELETE CASCADE,
        "schema_version" int NOT NULL,
        "source" varchar(16) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "normalized" jsonb NULL,
        "attribution" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "client_nonce" varchar(64) NULL,
        "ip_hash" varchar(64) NULL,
        "user_agent" varchar(400) NULL,
        "status" varchar(16) NOT NULL DEFAULT 'received',
        "error" text NULL,
        "contact_id" uuid NULL,
        "opportunity_id" uuid NULL,
        "outcome" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "processed_at" timestamptz NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "chk_form_submissions_source" CHECK ("source" IN ('page', 'embed', 'script', 'email')),
        CONSTRAINT "chk_form_submissions_status" CHECK (
          "status" IN ('received', 'accepted', 'duplicate', 'needs_review', 'spam', 'failed')
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_form_submissions_form_created"
        ON "form_submissions" ("form_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_form_submissions_rate"
        ON "form_submissions" ("form_id", "ip_hash", "created_at")
    `);
    // A browser retry with the same nonce never creates a second lead.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_form_submissions_nonce"
        ON "form_submissions" ("form_id", "client_nonce")
        WHERE "client_nonce" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "form_submissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "forms"`);
  }
}
