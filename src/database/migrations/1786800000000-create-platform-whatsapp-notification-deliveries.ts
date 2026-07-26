import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * LeadFlow Fase 5C-2: audit + idempotency for platform WhatsApp notifications.
 *
 * Records one row per handoff WhatsApp attempt, keyed by `idempotency_key`
 * (tenant+workspace+subject+handoffCycle+recipient+templateKey). The unique index
 * is what enforces "one delivery per handoff cycle per recipient" and lets the
 * provider refuse to resend after a success. Stores no credential — never the
 * access token — only the sanitized provider outcome.
 *
 * Additive and isolated: no existing table is touched. Agency Sales unaffected.
 */
export class CreatePlatformWhatsAppNotificationDeliveries1786800000000
  implements MigrationInterface
{
  name = 'CreatePlatformWhatsAppNotificationDeliveries1786800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_whatsapp_notification_deliveries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "idempotency_key" varchar(320) NOT NULL,
        "template_key" varchar(120) NOT NULL,
        "recipient_user_id" uuid NOT NULL,
        "subject_type" varchar(40) NOT NULL,
        "subject_id" varchar(128) NOT NULL,
        "handoff_cycle_id" varchar(64) NOT NULL,
        "status" varchar(16) NOT NULL,
        "provider_message_id" varchar(128),
        "provider_code" varchar(40),
        "sanitized_message" varchar(200),
        "attempts" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_platform_whatsapp_notification_deliveries" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_whatsapp_deliveries_key"
      ON "platform_whatsapp_notification_deliveries" ("idempotency_key")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_whatsapp_deliveries_scope"
      ON "platform_whatsapp_notification_deliveries" ("tenant_id", "workspace_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_platform_whatsapp_deliveries_scope"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_platform_whatsapp_deliveries_key"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "platform_whatsapp_notification_deliveries"`,
    );
  }
}
