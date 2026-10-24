import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Delivers Agenda appointment events to the CRM Lead Score consumer.
 *
 * Lead score policy v2 activates the meeting rules (confirmed/attended and
 * no-show), which read appointments — a domain the CRM command path never
 * sees. Same reasoning as 1786500000000: the consumer gets its own delivery
 * row, and the prefix (`leadflow.calendar.appointment.%`) cannot match the
 * score's own `leadflow.crm.%` events, so no recalculation loop is possible.
 *
 * Forward-only, like the inbox fan-out: past appointment events are not
 * replayed. The Automations, Analytics and Webhooks consumers are unchanged.
 */
const FUNCTION_HEAD = `
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
`;

const LEAD_SCORE_BLOCK = (condition: string) => `
    IF ${condition} THEN
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
`;

export class FanoutAppointmentsToLeadScore1800600000000
  implements MigrationInterface
{
  name = 'FanoutAppointmentsToLeadScore1800600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      FUNCTION_HEAD +
        LEAD_SCORE_BLOCK(
          `NEW."event_name" LIKE 'leadflow.inbox.%'
        OR NEW."event_name" LIKE 'leadflow.calendar.appointment.%'`,
        ),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      FUNCTION_HEAD + LEAD_SCORE_BLOCK(`NEW."event_name" LIKE 'leadflow.inbox.%'`),
    );
  }
}
