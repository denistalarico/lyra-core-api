import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The delivery log of the outbound webhook dispatcher.
 *
 * One row per (endpoint, source event), which is also the idempotency boundary:
 * the event stream is at-least-once, so the unique index is what stops a
 * redelivered event from posting the same order twice to a customer's system.
 *
 * The log is not an audit nicety. A webhook that "does not work" is almost
 * always a 401 the integrator never saw, so the status, the response excerpt
 * and the error code are the product — without them the only debugging tool is
 * asking the customer to check their own server.
 */
export class CreateLeadflowWebhookDeliveries1790000000000 implements MigrationInterface {
  name = 'CreateLeadflowWebhookDeliveries1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "leadflow_webhook_deliveries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "automation_id" uuid NOT NULL,
        "source_event_id" uuid NOT NULL,
        "event_name" varchar(120) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz,
        "request_url" text NOT NULL,
        "response_status" integer,
        "response_excerpt" text,
        "error_code" varchar(60),
        "duration_ms" integer,
        "delivered_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_lf_webhook_deliveries_automation"
          FOREIGN KEY ("automation_id")
          REFERENCES "leadflow_automations" ("id") ON DELETE CASCADE
      )
    `);

    // Deleting an endpoint must take its log with it: the rows are meaningless
    // without the configuration that produced them, and keeping them orphaned
    // would leave customer payload excerpts with no owner.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_webhook_deliveries_event"
        ON "leadflow_webhook_deliveries" ("automation_id", "source_event_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_webhook_deliveries_scope"
        ON "leadflow_webhook_deliveries" ("tenant_id", "workspace_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lf_webhook_deliveries_retry"
        ON "leadflow_webhook_deliveries" ("status", "next_attempt_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "leadflow_webhook_deliveries"`,
    );
  }
}
