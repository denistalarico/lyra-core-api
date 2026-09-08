import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Durable receipts for organic webhook deliveries (W1.1).
 *
 * Owned by `social-organic`, deliberately not `inbox_webhook_logs`: those rows
 * are verified against the Messaging app's secret and these against the Social
 * app's, so one table could not say which trust root admitted a row.
 *
 * Two schema decisions worth stating here rather than leaving to inference:
 *
 * - **The scope columns are nullable.** A webhook carries no `RequestContext`;
 *   scope is derived from the provider's asset id, and that derivation can fail
 *   honestly. `scope_resolution` records which case a NULL scope is.
 * - **`UQ_social_organic_webhook_events_key` is the idempotency guarantee.**
 *   Application code checks nothing; a redelivery is a unique violation, and
 *   that is what makes concurrent duplicate deliveries safe.
 *
 * No foreign key to `social_organic_assets`: a receipt must survive both an
 * asset that is not connected here and an asset that is later disconnected.
 */
export class CreateSocialOrganicWebhookEvents1792200000000 implements MigrationInterface {
  name = 'CreateSocialOrganicWebhookEvents1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_organic_webhook_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "provider" varchar(40) NOT NULL,
        "event_key" varchar(200) NOT NULL,
        "object_type" varchar(64) NOT NULL,
        "external_asset_id" varchar(180),
        "tenant_id" uuid,
        "workspace_id" uuid,
        "agency_client_id" uuid,
        "asset_id" uuid,
        "scope_resolution" varchar(40) NOT NULL DEFAULT 'unresolved_no_asset_id',
        "status" varchar(24) NOT NULL DEFAULT 'received',
        "received_at" timestamptz NOT NULL DEFAULT now(),
        "processed_at" timestamptz,
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 5,
        "available_at" timestamptz NOT NULL DEFAULT now(),
        "locked_at" timestamptz,
        "locked_by" varchar(120),
        "safe_error_code" varchar(240),
        "raw_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "retain_until" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_social_organic_webhook_events_status"
          CHECK ("status" IN (
            'received', 'processing', 'processed',
            'unhandled', 'failed', 'dead_letter'
          )),
        CONSTRAINT "CK_social_organic_webhook_events_scope_resolution"
          CHECK ("scope_resolution" IN (
            'resolved', 'unresolved_unknown_asset',
            'unresolved_ambiguous', 'unresolved_no_asset_id'
          ))
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_organic_webhook_events_key"
        ON "social_organic_webhook_events" ("provider", "event_key")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_webhook_events_queue"
        ON "social_organic_webhook_events" ("available_at")
        WHERE "status" = 'received'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_webhook_events_stale_lock"
        ON "social_organic_webhook_events" ("locked_at")
        WHERE "status" = 'processing'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_webhook_events_scope"
        ON "social_organic_webhook_events"
        ("tenant_id", "workspace_id", "agency_client_id", "received_at" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_organic_webhook_events_asset"
        ON "social_organic_webhook_events" ("asset_id", "received_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_social_organic_webhook_events_asset"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_social_organic_webhook_events_scope"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_social_organic_webhook_events_stale_lock"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_social_organic_webhook_events_queue"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_social_organic_webhook_events_key"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "social_organic_webhook_events"`,
    );
  }
}
