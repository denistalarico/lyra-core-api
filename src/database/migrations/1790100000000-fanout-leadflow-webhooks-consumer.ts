import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the outbound webhook delivery stream.
 *
 * The fan-out is a trigger function, so a new consumer is a migration and not a
 * code change — recreating the whole function is the only way to add a row to
 * its VALUES list, which is why this file restates the consumers that already
 * exist. Forward-only, like the two before it: existing outbox rows are not
 * backfilled, because an endpoint configured today should not be flooded with
 * everything that happened before it existed.
 */
export class FanoutLeadflowWebhooksConsumer1790100000000 implements MigrationInterface {
  name = 'FanoutLeadflowWebhooksConsumer1790100000000';

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
          ), (
            NEW."id", 'leadflow.analytics', NEW."tenant_id", NEW."workspace_id",
            NEW."event_name", NEW."event_version", NEW."aggregate_type",
            NEW."aggregate_id", NEW."idempotency_key", NEW."payload", NEW."created_at"
          ), (
            NEW."id", 'leadflow.webhooks', NEW."tenant_id", NEW."workspace_id",
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
          ), (
            NEW."id", 'leadflow.analytics', NEW."tenant_id", NEW."workspace_id",
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
}
