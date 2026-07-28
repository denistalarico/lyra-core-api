import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformAdminSessions1787200000000 implements MigrationInterface {
  name = 'CreatePlatformAdminSessions1787200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_admin_sessions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "admin_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "identity_tenant_id" uuid NOT NULL,
        "refresh_token_hash" text NOT NULL,
        "previous_refresh_token_hash" text,
        "status" varchar(20) NOT NULL,
        "title" varchar(120) NOT NULL,
        "browser" varchar(120) NOT NULL,
        "user_agent" text,
        "accept_language" varchar(120),
        "ip_address" varchar(120),
        "device_fingerprint" varchar(64),
        "device_name" varchar(120),
        "location" varchar(120),
        "last_seen_at" timestamptz NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_platform_admin_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "fk_platform_admin_sessions_admin"
          FOREIGN KEY ("admin_id") REFERENCES "platform_internal_admins"("id")
          ON DELETE CASCADE,
        CONSTRAINT "ck_platform_admin_sessions_status"
          CHECK ("status" IN ('active', 'expired', 'revoked'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_admin_sessions_admin_id"
      ON "platform_admin_sessions" ("admin_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_admin_sessions_user_id"
      ON "platform_admin_sessions" ("user_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_platform_admin_sessions_refresh_token_hash"
      ON "platform_admin_sessions" ("refresh_token_hash")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_admin_sessions_status"
      ON "platform_admin_sessions" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_admin_sessions_expires_at"
      ON "platform_admin_sessions" ("expires_at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_admin_two_factor_codes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "admin_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "identity_tenant_id" uuid NOT NULL,
        "code_hash" text NOT NULL,
        "purpose" varchar(20) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "attempts" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_platform_admin_two_factor_codes" PRIMARY KEY ("id"),
        CONSTRAINT "fk_platform_admin_two_factor_codes_admin"
          FOREIGN KEY ("admin_id") REFERENCES "platform_internal_admins"("id")
          ON DELETE CASCADE,
        CONSTRAINT "ck_platform_admin_two_factor_codes_purpose"
          CHECK ("purpose" IN ('admin_login', 'admin_setup'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_admin_2fa_codes_admin_purpose"
      ON "platform_admin_two_factor_codes" ("admin_id", "purpose")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "platform_admin_two_factor_codes"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_admin_sessions"`);
  }
}
