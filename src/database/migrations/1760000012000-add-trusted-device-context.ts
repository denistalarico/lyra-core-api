import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTrustedDeviceContext1760000012000 implements MigrationInterface {
  name = 'AddTrustedDeviceContext1760000012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "user_trusted_devices"
      ADD COLUMN IF NOT EXISTS "device_fingerprint" varchar(64),
      ADD COLUMN IF NOT EXISTS "device_name" varchar(120),
      ADD COLUMN IF NOT EXISTS "user_agent" text,
      ADD COLUMN IF NOT EXISTS "ip_address" varchar(120),
      ADD COLUMN IF NOT EXISTS "last_used_at" timestamptz,
      ADD COLUMN IF NOT EXISTS "revoked_at" timestamptz;
    `);

    await queryRunner.query(`
      UPDATE "user_trusted_devices"
      SET
        "device_name" = COALESCE("device_name", "name"),
        "last_used_at" = COALESCE("last_used_at", "trusted_at", "created_at"),
        "revoked_at" = COALESCE("revoked_at", "removed_at")
      WHERE
        "device_name" IS NULL
        OR "last_used_at" IS NULL
        OR ("revoked_at" IS NULL AND "removed_at" IS NOT NULL);
    `);

    await queryRunner.query(`
      ALTER TABLE "user_trusted_devices"
      ALTER COLUMN "name" DROP NOT NULL,
      ALTER COLUMN "browser" DROP NOT NULL,
      ALTER COLUMN "location" DROP NOT NULL,
      ALTER COLUMN "last_seen" DROP NOT NULL,
      ALTER COLUMN "status" DROP NOT NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_trusted_devices_tenant_user_device"
      ON "user_trusted_devices" ("tenant_id", "user_id", "device_fingerprint");
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_trusted_devices_active_device"
      ON "user_trusted_devices" ("tenant_id", "user_id", "device_fingerprint")
      WHERE "revoked_at" IS NULL AND "device_fingerprint" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_user_trusted_devices_active_device";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_trusted_devices_tenant_user_device";`,
    );
    await queryRunner.query(`
      ALTER TABLE "user_trusted_devices"
      DROP COLUMN IF EXISTS "revoked_at",
      DROP COLUMN IF EXISTS "last_used_at",
      DROP COLUMN IF EXISTS "ip_address",
      DROP COLUMN IF EXISTS "user_agent",
      DROP COLUMN IF EXISTS "device_name",
      DROP COLUMN IF EXISTS "device_fingerprint";
    `);
  }
}
