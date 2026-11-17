import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Forms addon F4 (2026-11-17): leads by e-mail through the agency's IMAP box.
 * Plan: docs/sprints/forms-addon-implementation-plan-2026-11-17.md (§4.3, §6).
 */
export class AddFormsInboundEmail1804700000000 implements MigrationInterface {
  name = 'AddFormsInboundEmail1804700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "forms"
        ADD COLUMN IF NOT EXISTS "inbound_email_address" varchar(254) NULL,
        ADD COLUMN IF NOT EXISTS "inbound_email" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_forms_inbound_email_address"
        ON "forms" ("workspace_id", "inbound_email_address")
        WHERE "inbound_email_address" IS NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "form_submissions"
        ADD COLUMN IF NOT EXISTS "email_message_id" varchar(998) NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_form_submissions_email_message"
        ON "form_submissions" ("form_id", "email_message_id")
        WHERE "email_message_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "form_email_sync_state" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "mailbox" varchar(120) NOT NULL DEFAULT 'INBOX',
        "uid_validity" varchar(40) NULL,
        "last_uid" bigint NOT NULL DEFAULT 0,
        "last_polled_at" timestamptz NULL,
        "last_success_at" timestamptz NULL,
        "last_error" text NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "uq_form_email_sync_state_workspace" UNIQUE ("tenant_id", "workspace_id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "form_email_sync_state"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_form_submissions_email_message"`,
    );
    await queryRunner.query(
      `ALTER TABLE "form_submissions" DROP COLUMN IF EXISTS "email_message_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_forms_inbound_email_address"`,
    );
    await queryRunner.query(`
      ALTER TABLE "forms"
        DROP COLUMN IF EXISTS "inbound_email",
        DROP COLUMN IF EXISTS "inbound_email_address"
    `);
  }
}
