import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a second durable fan-out consumer for the CRM Lead Score.
 *
 * The existing trigger copied every `leadflow.%` outbox event to a single
 * consumer (`leadflow.automations`). This replaces the function so it also
 * writes a `leadflow.crm.lead_score` delivery — an independent, per-consumer
 * copy that never touches the automations deliveries.
 *
 * The lead score consumer receives only `leadflow.inbox.%` events. Two reasons,
 * both deliberate:
 *
 *  - The CRM's own mutations already recalculate the score in-process, in the
 *    same request that changed the deal. Fanning those out again would score
 *    the same change twice.
 *  - The score's own events are `leadflow.crm.%`, so an `inbox` prefix excludes
 *    them structurally. A consumer that recalculated on `score.changed` would
 *    emit another `score.changed` and never stop. Preventing that at the source
 *    is stronger than relying on an application-level allowlist alone.
 *
 * Backfilling existing rows into the new consumer is intentionally NOT done: the
 * consumer is forward-only, and replaying historical inbox events as if they had
 * just arrived would write score history at the wrong moments.
 */
export class FanoutLeadScoreConsumer1786500000000 implements MigrationInterface {
  name = 'FanoutLeadScoreConsumer1786500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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

        IF NEW."event_name" LIKE 'leadflow.inbox.%' THEN
          INSERT INTO "leadflow_event_deliveries" (
            "source_event_id", "consumer_key", "tenant_id", "workspace_id",
            "event_name", "event_version", "aggregate_type", "aggregate_id",
            "source_idempotency_key", "payload", "occurred_at"
          ) VALUES (
            NEW."id", 'leadflow.crm.lead_score', NEW."tenant_id", NEW."workspace_id",
            NEW."event_name", NEW."event_version", NEW."aggregate_type",
            NEW."aggregate_id", NEW."idempotency_key", NEW."payload", NEW."created_at"
          ) ON CONFLICT ("source_event_id", "consumer_key") DO NOTHING;
        END IF;

        RETURN NEW;
      END;
      $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the single-consumer function. Existing lead_score deliveries are
    // left in place; they simply stop being produced.
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
  }
}
