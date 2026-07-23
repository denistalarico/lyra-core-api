import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds consumer-specific durable delivery without changing the realtime outbox
 * lifecycle. Only events inserted after this migration are fanned out: old
 * retained events are deliberately not replayed into a newly enabled runtime.
 */
export class CreateLeadflowEventDeliveries1785700000000 implements MigrationInterface {
  name = 'CreateLeadflowEventDeliveries1785700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_event_deliveries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "source_event_id" uuid NOT NULL,
        "consumer_key" character varying(120) NOT NULL,
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "event_name" character varying(120) NOT NULL,
        "event_version" integer NOT NULL,
        "aggregate_type" character varying(60) NOT NULL,
        "aggregate_id" uuid NOT NULL,
        "source_idempotency_key" character varying(180) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "occurred_at" timestamptz NOT NULL,
        "status" character varying(24) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "locked_at" timestamptz,
        "locked_by" character varying(120),
        "delivered_at" timestamptz,
        "skipped_at" timestamptz,
        "skip_reason" character varying(80),
        "dead_lettered_at" timestamptz,
        "last_error" character varying(80),
        "retain_until" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lf_event_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "CK_lf_event_deliveries_status" CHECK (
          "status" IN ('pending', 'processing', 'delivered', 'skipped', 'dead_letter')
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_event_deliveries_source_consumer"
      ON "leadflow_event_deliveries" ("source_event_id", "consumer_key")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_event_deliveries_claim"
      ON "leadflow_event_deliveries"
        ("consumer_key", "status", "available_at", "locked_at", "occurred_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_event_deliveries_scope"
      ON "leadflow_event_deliveries"
        ("tenant_id", "workspace_id", "consumer_key", "occurred_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_event_deliveries_retention"
      ON "leadflow_event_deliveries" ("retain_until")
      WHERE "status" IN ('delivered', 'skipped', 'dead_letter')
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "fanout_leadflow_outbox_event"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        IF NEW."event_name" LIKE 'leadflow.%' THEN
          INSERT INTO "leadflow_event_deliveries" (
            "source_event_id", "consumer_key", "tenant_id", "workspace_id",
            "event_name", "event_version", "aggregate_type", "aggregate_id",
            "source_idempotency_key", "payload", "occurred_at"
          ) VALUES (
            NEW."id", 'leadflow.automations', NEW."tenant_id", NEW."workspace_id",
            NEW."event_name", NEW."event_version", NEW."aggregate_type",
            NEW."aggregate_id", NEW."idempotency_key", NEW."payload", NEW."created_at"
          ) ON CONFLICT ("source_event_id", "consumer_key") DO NOTHING;
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TRG_fanout_leadflow_outbox_event"
      AFTER INSERT ON "inbox_domain_outbox"
      FOR EACH ROW EXECUTE FUNCTION "fanout_leadflow_outbox_event"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TRG_fanout_leadflow_outbox_event" ON "inbox_domain_outbox"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS "fanout_leadflow_outbox_event"()',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "leadflow_event_deliveries"');
  }
}
