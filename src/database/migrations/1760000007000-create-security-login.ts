import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSecurityLogin1760000007000 implements MigrationInterface {
  name = 'CreateSecurityLogin1760000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_security_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "current_email" varchar(160) NOT NULL DEFAULT '',
        "password_hash" text,
        "password_updated_at" timestamptz,
        "two_factor_enabled" boolean NOT NULL DEFAULT false,
        "two_factor_method" varchar(20) NOT NULL DEFAULT 'authenticator',
        "two_factor_secret_encrypted" text,
        "two_factor_pending_secret_encrypted" text,
        "login_alerts_enabled" boolean NOT NULL DEFAULT true,
        "trusted_devices_enabled" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_security_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_user_security_settings_tenant_user" UNIQUE ("tenant_id", "user_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_security_settings_tenant_user"
      ON "user_security_settings" ("tenant_id", "user_id");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "session_token_hash" text,
        "title" varchar(120) NOT NULL,
        "browser" varchar(120) NOT NULL,
        "location" varchar(120) NOT NULL,
        "last_seen" varchar(120) NOT NULL,
        "status" varchar(20) NOT NULL,
        "revoked_at" timestamptz,
        "expires_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_sessions_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_sessions_tenant_user"
      ON "user_sessions" ("tenant_id", "user_id");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_trusted_devices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "browser" varchar(120) NOT NULL,
        "location" varchar(120) NOT NULL,
        "last_seen" varchar(120) NOT NULL,
        "status" varchar(20) NOT NULL,
        "trusted_at" timestamptz,
        "removed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_trusted_devices_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_trusted_devices_tenant_user"
      ON "user_trusted_devices" ("tenant_id", "user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_trusted_devices_tenant_user";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "user_trusted_devices";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_sessions_tenant_user";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "user_sessions";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_security_settings_tenant_user";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "user_security_settings";`);
  }
}
