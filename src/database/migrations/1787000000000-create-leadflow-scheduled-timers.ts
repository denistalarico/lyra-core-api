import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * LeadFlow Fase 6A: durable PostgreSQL implementation of SchedulerRuntime.
 *
 * Additive and isolated. The table contains validated timer payloads, never
 * credentials or raw provider responses. The partial unique index is the
 * database-level idempotency boundary for active timers.
 */
export class CreateLeadflowScheduledTimers1787000000000 implements MigrationInterface {
  name = 'CreateLeadflowScheduledTimers1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_scheduled_timers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "timer_key" varchar(240) NOT NULL,
        "dedupe_scope" varchar(180) NOT NULL DEFAULT '',
        "fire_at" timestamptz NOT NULL,
        "purpose" varchar(48) NOT NULL,
        "consumer_key" varchar(120) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" varchar(24) NOT NULL DEFAULT 'scheduled',
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 8,
        "available_at" timestamptz NOT NULL,
        "locked_at" timestamptz,
        "locked_by" varchar(140),
        "fired_at" timestamptz,
        "cancelled_at" timestamptz,
        "superseded_at" timestamptz,
        "dead_lettered_at" timestamptz,
        "last_error" varchar(100),
        "retain_until" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_scheduled_timers" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_scheduled_timers_active_key"
      ON "leadflow_scheduled_timers"
        ("tenant_id", "workspace_id", "dedupe_scope", "timer_key")
      WHERE "status" IN ('scheduled', 'processing')
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_scheduled_timers_claim"
      ON "leadflow_scheduled_timers"
        ("status", "available_at", "fire_at", "locked_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_scheduled_timers_scope"
      ON "leadflow_scheduled_timers"
        ("tenant_id", "workspace_id", "consumer_key", "created_at")
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_scheduled_timers"
      DROP CONSTRAINT IF EXISTS "CHK_lf_scheduled_timers_status"
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_scheduled_timers"
      ADD CONSTRAINT "CHK_lf_scheduled_timers_status"
      CHECK ("status" IN (
        'scheduled', 'processing', 'fired', 'cancelled',
        'superseded', 'dead_letter'
      ))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "leadflow_scheduled_timers"`);
  }
}
