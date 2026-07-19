import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInboxOutboxLifecycle1784520000000 implements MigrationInterface {
  name = 'AddInboxOutboxLifecycle1784520000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "inbox_domain_outbox"
        ADD COLUMN IF NOT EXISTS "delivery_kind" varchar(24) NOT NULL DEFAULT 'realtime',
        ADD COLUMN IF NOT EXISTS "skipped_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "skip_reason" varchar(80),
        ADD COLUMN IF NOT EXISTS "retain_until" timestamptz
    `);
    await queryRunner.query(`
      ALTER TABLE "inbox_domain_outbox"
        DROP CONSTRAINT IF EXISTS "chk_inbox_outbox_status",
        ADD CONSTRAINT "chk_inbox_outbox_status"
          CHECK ("status" IN ('pending', 'processing', 'published', 'skipped', 'dead_letter'))
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_inbox_outbox_retention"
      ON "inbox_domain_outbox" ("retain_until")
      WHERE "status" IN ('published', 'skipped', 'dead_letter')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_inbox_outbox_retention"',
    );
    await queryRunner.query(
      `UPDATE "inbox_domain_outbox" SET "status" = 'published', "published_at" = COALESCE("published_at", "skipped_at", now()) WHERE "status" = 'skipped'`,
    );
    await queryRunner.query(`
      ALTER TABLE "inbox_domain_outbox"
        DROP CONSTRAINT IF EXISTS "chk_inbox_outbox_status",
        ADD CONSTRAINT "chk_inbox_outbox_status"
          CHECK ("status" IN ('pending', 'processing', 'published', 'dead_letter')),
        DROP COLUMN IF EXISTS "retain_until",
        DROP COLUMN IF EXISTS "skip_reason",
        DROP COLUMN IF EXISTS "skipped_at",
        DROP COLUMN IF EXISTS "delivery_kind"
    `);
  }
}
