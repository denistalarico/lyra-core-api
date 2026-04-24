// src/database/migrations/1760000008000-create-user-notifications.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserNotifications1760000008000 implements MigrationInterface {
  name = 'CreateUserNotifications1760000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_notifications" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "type" varchar(30) NOT NULL DEFAULT 'info',
        "title" varchar(160) NOT NULL,
        "message" varchar(500) NOT NULL,
        "href" varchar(255),
        "is_read" boolean NOT NULL DEFAULT false,
        "read_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_notifications_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_notifications_tenant_user"
      ON "user_notifications" ("tenant_id", "user_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_notifications_user_read"
      ON "user_notifications" ("user_id", "is_read");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_notifications_user_read";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_notifications_tenant_user";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "user_notifications";`);
  }
}
