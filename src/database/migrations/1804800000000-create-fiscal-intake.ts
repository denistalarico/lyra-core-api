import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Forms addon F5 (2026-11-17): the accountant's fiscal intake link and the A1
 * certificate, encrypted with FISCAL_CERT_ENCRYPTION_KEY (never in S3).
 *
 * The approved data lands in the existing `finance_fiscal_profiles` (one per
 * workspace) instead of a second profile table: Settings > Finance > Fiscal
 * keeps being the only place the fiscal profile lives.
 * Plan: docs/sprints/forms-addon-implementation-plan-2026-11-17.md (§4.4, §8).
 */
export class CreateFiscalIntake1804800000000 implements MigrationInterface {
  name = 'CreateFiscalIntake1804800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "finance_fiscal_profiles"
        ADD COLUMN IF NOT EXISTS "company_data" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "certificate_encrypted" bytea NULL,
        ADD COLUMN IF NOT EXISTS "certificate_key_version" integer NULL,
        ADD COLUMN IF NOT EXISTS "certificate_meta" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "certificate_alert_level" integer NULL,
        ADD COLUMN IF NOT EXISTS "municipal_portal_password_encrypted" text NULL,
        ADD COLUMN IF NOT EXISTS "intake_approved_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "intake_approved_by_user_id" uuid NULL
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fiscal_intake_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "scope" varchar(20) NOT NULL DEFAULT 'full',
        "status" varchar(20) NOT NULL DEFAULT 'open',
        "token_hash" varchar(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "recipient_name" varchar(160) NULL,
        "recipient_email" varchar(254) NULL,
        "created_by_user_id" uuid NULL,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "data" jsonb NULL,
        "certificate_encrypted" bytea NULL,
        "certificate_password_encrypted" text NULL,
        "municipal_portal_password_encrypted" text NULL,
        "certificate_key_version" integer NULL,
        "certificate_meta" jsonb NULL,
        "submitted_at" timestamptz NULL,
        "reviewed_by_user_id" uuid NULL,
        "reviewed_at" timestamptz NULL,
        "review_note" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_fiscal_intake_requests_token"
        ON "fiscal_intake_requests" ("token_hash")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_fiscal_intake_requests_workspace"
        ON "fiscal_intake_requests" ("tenant_id", "workspace_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "fiscal_profile_audit_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "action" varchar(60) NOT NULL,
        "actor_kind" varchar(20) NOT NULL,
        "actor_user_id" uuid NULL,
        "intake_request_id" uuid NULL,
        "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_fiscal_profile_audit_workspace"
        ON "fiscal_profile_audit_events" ("tenant_id", "workspace_id", "created_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "fiscal_profile_audit_events"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "fiscal_intake_requests"`);
    await queryRunner.query(`
      ALTER TABLE "finance_fiscal_profiles"
        DROP COLUMN IF EXISTS "intake_approved_by_user_id",
        DROP COLUMN IF EXISTS "intake_approved_at",
        DROP COLUMN IF EXISTS "municipal_portal_password_encrypted",
        DROP COLUMN IF EXISTS "certificate_alert_level",
        DROP COLUMN IF EXISTS "certificate_meta",
        DROP COLUMN IF EXISTS "certificate_key_version",
        DROP COLUMN IF EXISTS "certificate_encrypted",
        DROP COLUMN IF EXISTS "company_data"
    `);
  }
}
