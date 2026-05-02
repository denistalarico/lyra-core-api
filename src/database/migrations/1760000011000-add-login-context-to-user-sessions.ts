import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLoginContextToUserSessions1760000011000 implements MigrationInterface {
  name = 'AddLoginContextToUserSessions1760000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_sessions"
      ADD COLUMN IF NOT EXISTS "user_agent" text,
      ADD COLUMN IF NOT EXISTS "accept_language" varchar(120),
      ADD COLUMN IF NOT EXISTS "ip_address" varchar(120),
      ADD COLUMN IF NOT EXISTS "device_fingerprint" varchar(64),
      ADD COLUMN IF NOT EXISTS "device_name" varchar(120);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_sessions_tenant_user_device"
      ON "user_sessions" ("tenant_id", "user_id", "device_fingerprint");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_sessions_tenant_user_ip"
      ON "user_sessions" ("tenant_id", "user_id", "ip_address");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_sessions_tenant_user_ip";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_sessions_tenant_user_device";`,
    );
    await queryRunner.query(`
      ALTER TABLE "user_sessions"
      DROP COLUMN IF EXISTS "device_name",
      DROP COLUMN IF EXISTS "device_fingerprint",
      DROP COLUMN IF EXISTS "ip_address",
      DROP COLUMN IF EXISTS "accept_language",
      DROP COLUMN IF EXISTS "user_agent";
    `);
  }
}
