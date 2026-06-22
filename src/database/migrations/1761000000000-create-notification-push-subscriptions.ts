import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationPushSubscriptions1761000000000
  implements MigrationInterface
{
  name = 'CreateNotificationPushSubscriptions1761000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_push_subscriptions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "endpoint" text NOT NULL,
        "p256dh_key" text NOT NULL,
        "auth_key" text NOT NULL,
        "user_agent" varchar(200),
        "last_used_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_notification_push_subscriptions_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_notification_push_subscriptions_tenant_user"
      ON "notification_push_subscriptions" ("tenant_id", "user_id");
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_push_subscriptions_endpoint"
      ON "notification_push_subscriptions" ("endpoint");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_notification_push_subscriptions_endpoint";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_notification_push_subscriptions_tenant_user";`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "notification_push_subscriptions";`,
    );
  }
}
