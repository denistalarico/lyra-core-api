import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the forward-only Analytics delivery stream.
 *
 * Existing outbox rows are deliberately not backfilled: Phase 7A establishes
 * the boundary for future events, while historical reports continue to query
 * their existing operational sources.
 */
export class FanoutLeadflowAnalyticsConsumer1787800000000 implements MigrationInterface {
  name = 'FanoutLeadflowAnalyticsConsumer1787800000000';

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
