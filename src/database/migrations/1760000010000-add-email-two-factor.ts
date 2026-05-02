import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailTwoFactor1760000010000 implements MigrationInterface {
  name = 'AddEmailTwoFactor1760000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_security_settings"
      ADD COLUMN IF NOT EXISTS "two_factor_method" varchar(20) NOT NULL DEFAULT 'authenticator';
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auth_email_2fa_codes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "code_hash" text NOT NULL,
        "purpose" varchar(20) NOT NULL DEFAULT 'login',
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "attempts" int NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_auth_email_2fa_codes_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_auth_email_2fa_codes_tenant_user_purpose"
      ON "auth_email_2fa_codes" ("tenant_id", "user_id", "purpose");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_auth_email_2fa_codes_tenant_user_purpose";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "auth_email_2fa_codes";`);
    await queryRunner.query(`
      ALTER TABLE "user_security_settings"
      DROP COLUMN IF EXISTS "two_factor_method";
    `);
  }
}
