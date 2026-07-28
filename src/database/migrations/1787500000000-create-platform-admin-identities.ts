import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformAdminIdentities1787500000000 implements MigrationInterface {
  name = 'CreatePlatformAdminIdentities1787500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "platform_admin_identities" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" varchar(320) NOT NULL,
        "normalized_email" varchar(320) NOT NULL,
        "display_name" varchar(160) NOT NULL,
        "status" varchar(20) NOT NULL,
        "password_hash" text,
        "password_configured_at" timestamptz,
        "two_factor_enabled" boolean NOT NULL DEFAULT false,
        "two_factor_method" varchar(30),
        "two_factor_secret_encrypted" text,
        "two_factor_pending_secret_encrypted" text,
        "email_verified_at" timestamptz,
        "last_password_change_at" timestamptz,
        "failed_login_attempts" integer NOT NULL DEFAULT 0,
        "locked_until" timestamptz,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_platform_admin_identities" PRIMARY KEY ("id"),
        CONSTRAINT "ck_platform_admin_identities_status"
          CHECK ("status" IN ('pending', 'active', 'locked', 'disabled')),
        CONSTRAINT "ck_platform_admin_identities_2fa_method"
          CHECK ("two_factor_method" IS NULL OR "two_factor_method" IN ('authenticator', 'email'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_platform_admin_identities_normalized_email"
      ON "platform_admin_identities" ("normalized_email")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_platform_admin_identities_status"
      ON "platform_admin_identities" ("status")
    `);

    await queryRunner.query(`
      CREATE TABLE "platform_admin_identity_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "identity_id" uuid NOT NULL,
        "purpose" varchar(40) NOT NULL,
        "token_hash" varchar(128) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "consumed_at" timestamptz,
        "revoked_at" timestamptz,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_platform_admin_identity_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "fk_platform_admin_identity_tokens_identity"
          FOREIGN KEY ("identity_id") REFERENCES "platform_admin_identities"("id") ON DELETE CASCADE,
        CONSTRAINT "ck_platform_admin_identity_tokens_purpose"
          CHECK ("purpose" IN (
            'initial_password_setup',
            'password_reset',
            'two_factor_recovery',
            'email_verification'
          ))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_platform_admin_identity_tokens_hash"
      ON "platform_admin_identity_tokens" ("token_hash")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_platform_admin_identity_tokens_identity_purpose"
      ON "platform_admin_identity_tokens" ("identity_id", "purpose")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_platform_admin_identity_tokens_expires_at"
      ON "platform_admin_identity_tokens" ("expires_at")
    `);

    await queryRunner.query(`
      ALTER TABLE "platform_internal_admins"
      ADD COLUMN "identity_source" varchar(30),
      ADD COLUMN "platform_admin_identity_id" uuid
    `);
    await queryRunner.query(`
      UPDATE "platform_internal_admins"
      SET "identity_source" = 'agency'
      WHERE "identity_source" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "platform_internal_admins"
      ALTER COLUMN "identity_source" SET NOT NULL,
      ALTER COLUMN "identity_tenant_id" DROP NOT NULL,
      ALTER COLUMN "user_id" DROP NOT NULL,
      ADD CONSTRAINT "fk_platform_internal_admins_platform_identity"
        FOREIGN KEY ("platform_admin_identity_id") REFERENCES "platform_admin_identities"("id"),
      ADD CONSTRAINT "ck_platform_internal_admins_identity_source"
        CHECK ("identity_source" IN ('agency', 'platform_admin')),
      ADD CONSTRAINT "ck_platform_internal_admins_identity_reference"
        CHECK (
          (
            "identity_source" = 'agency'
            AND "identity_tenant_id" IS NOT NULL
            AND "user_id" IS NOT NULL
            AND "platform_admin_identity_id" IS NULL
          )
          OR
          (
            "identity_source" = 'platform_admin'
            AND "identity_tenant_id" IS NULL
            AND "user_id" IS NULL
            AND "platform_admin_identity_id" IS NOT NULL
          )
        )
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_platform_internal_admins_identity"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_platform_internal_admins_agency_identity"
      ON "platform_internal_admins" ("identity_tenant_id", "user_id")
      WHERE "identity_source" = 'agency'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_platform_internal_admins_platform_identity"
      ON "platform_internal_admins" ("platform_admin_identity_id")
      WHERE "identity_source" = 'platform_admin'
    `);

    for (const table of [
      'platform_admin_sessions',
      'platform_admin_two_factor_codes',
    ]) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ADD COLUMN "identity_source" varchar(30),
        ADD COLUMN "platform_admin_identity_id" uuid
      `);
      await queryRunner.query(`
        UPDATE "${table}" SET "identity_source" = 'agency'
        WHERE "identity_source" IS NULL
      `);
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ALTER COLUMN "identity_source" SET NOT NULL,
        ALTER COLUMN "identity_tenant_id" DROP NOT NULL,
        ALTER COLUMN "user_id" DROP NOT NULL,
        ADD CONSTRAINT "fk_${table}_platform_identity"
          FOREIGN KEY ("platform_admin_identity_id") REFERENCES "platform_admin_identities"("id"),
        ADD CONSTRAINT "ck_${table}_identity_reference"
          CHECK (
            (
              "identity_source" = 'agency'
              AND "identity_tenant_id" IS NOT NULL
              AND "user_id" IS NOT NULL
              AND "platform_admin_identity_id" IS NULL
            )
            OR
            (
              "identity_source" = 'platform_admin'
              AND "identity_tenant_id" IS NULL
              AND "user_id" IS NULL
              AND "platform_admin_identity_id" IS NOT NULL
            )
          )
      `);
    }
    await queryRunner.query(`
      CREATE INDEX "idx_platform_admin_sessions_platform_identity"
      ON "platform_admin_sessions" ("platform_admin_identity_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_platform_admin_2fa_codes_platform_identity"
      ON "platform_admin_two_factor_codes" ("platform_admin_identity_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "platform_admin_invitations"
      WHERE "invited_by_admin_id" IN (
        SELECT "id" FROM "platform_internal_admins"
        WHERE "identity_source" = 'platform_admin'
      )
    `);
    await queryRunner.query(`
      DELETE FROM "platform_admin_two_factor_codes"
      WHERE "identity_source" = 'platform_admin'
    `);
    await queryRunner.query(`
      DELETE FROM "platform_admin_sessions"
      WHERE "identity_source" = 'platform_admin'
    `);
    for (const table of [
      'platform_admin_two_factor_codes',
      'platform_admin_sessions',
    ]) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
        DROP CONSTRAINT IF EXISTS "ck_${table}_identity_reference",
        DROP CONSTRAINT IF EXISTS "fk_${table}_platform_identity",
        DROP COLUMN IF EXISTS "platform_admin_identity_id",
        DROP COLUMN IF EXISTS "identity_source"
      `);
      await queryRunner.query(`
        ALTER TABLE "${table}"
        ALTER COLUMN "identity_tenant_id" SET NOT NULL,
        ALTER COLUMN "user_id" SET NOT NULL
      `);
    }
    await queryRunner.query(`
      DELETE FROM "platform_internal_admins"
      WHERE "identity_source" = 'platform_admin'
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_platform_internal_admins_platform_identity"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_platform_internal_admins_agency_identity"`,
    );
    await queryRunner.query(`
      ALTER TABLE "platform_internal_admins"
      DROP CONSTRAINT IF EXISTS "ck_platform_internal_admins_identity_reference",
      DROP CONSTRAINT IF EXISTS "ck_platform_internal_admins_identity_source",
      DROP CONSTRAINT IF EXISTS "fk_platform_internal_admins_platform_identity",
      DROP COLUMN IF EXISTS "platform_admin_identity_id",
      DROP COLUMN IF EXISTS "identity_source",
      ALTER COLUMN "identity_tenant_id" SET NOT NULL,
      ALTER COLUMN "user_id" SET NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_platform_internal_admins_identity"
      ON "platform_internal_admins" ("identity_tenant_id", "user_id")
    `);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "platform_admin_identity_tokens"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_admin_identities"`);
  }
}
