import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOperationsRoomOutboxDelivery1784000000000 implements MigrationInterface {
  name = 'AddOperationsRoomOutboxDelivery1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leadflow_operations_room_event_outbox"
      DROP CONSTRAINT IF EXISTS "CK_lf_room_outbox_delivery"
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_operations_room_event_outbox"
      ADD COLUMN "attempt_count" integer NOT NULL DEFAULT 0,
      ADD COLUMN "next_attempt_at" timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN "claimed_at" timestamptz,
      ADD COLUMN "claim_owner" varchar(120),
      ADD COLUMN "last_error_code" varchar(80),
      ADD COLUMN "published_at" timestamptz,
      ADD COLUMN "dead_lettered_at" timestamptz
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_operations_room_event_outbox"
      ADD CONSTRAINT "CK_lf_room_outbox_delivery"
      CHECK ("delivery_state" IN ('pending', 'processing', 'published', 'dead_letter'))
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_room_outbox_delivery_claim"
      ON "leadflow_operations_room_event_outbox"
      ("delivery_state", "next_attempt_at", "claimed_at", "created_at")
      WHERE "published_at" IS NULL AND "dead_lettered_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_lf_room_outbox_delivery_claim"
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_operations_room_event_outbox"
      DROP CONSTRAINT IF EXISTS "CK_lf_room_outbox_delivery"
    `);
    await queryRunner.query(`
      UPDATE "leadflow_operations_room_event_outbox"
      SET "delivery_state" = 'pending'
      WHERE "delivery_state" <> 'pending'
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_operations_room_event_outbox"
      DROP COLUMN "dead_lettered_at",
      DROP COLUMN "published_at",
      DROP COLUMN "last_error_code",
      DROP COLUMN "claim_owner",
      DROP COLUMN "claimed_at",
      DROP COLUMN "next_attempt_at",
      DROP COLUMN "attempt_count"
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_operations_room_event_outbox"
      ADD CONSTRAINT "CK_lf_room_outbox_delivery"
      CHECK ("delivery_state" IN ('pending'))
    `);
  }
}
