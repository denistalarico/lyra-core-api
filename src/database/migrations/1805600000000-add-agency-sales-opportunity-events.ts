import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AG-EVT (2026-11-20): history of the Agency sales CRM (`agency-sales`).
 * Plan: docs/sprints/social/social-google-ads-leads-analytics-plan-2026-11-18.md (§5.5 AG-EVT-BE).
 *
 * Insert-only. Kept apart from the LeadFlow CRM (`crm_opportunity_events`):
 * an agency may use either CRM or both. Rows carry ids, stage, status,
 * value and owner only; never title, description or contact (lead PII).
 * `occurred_at` has millisecond precision so the `(occurred_at, id)` cursor
 * matches the JS `Date` the readers send back. No backfill.
 */
export class AddAgencySalesOpportunityEvents1805600000000 implements MigrationInterface {
  name = 'AddAgencySalesOpportunityEvents1805600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agency_sales_opportunity_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "opportunity_id" uuid NOT NULL,
        "event_type" varchar(40) NOT NULL,
        "before_data" jsonb NULL,
        "after_data" jsonb NOT NULL,
        "actor_type" varchar(16) NOT NULL,
        "actor_user_id" uuid NULL,
        "idempotency_key" varchar(120) NULL,
        "occurred_at" timestamptz(3) NOT NULL DEFAULT now(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_sales_opportunity_events" PRIMARY KEY ("id"),
        CONSTRAINT "CK_agency_sales_opportunity_events_type" CHECK ("event_type" IN (
          'opportunity_created', 'stage_changed', 'status_changed',
          'opportunity_won', 'opportunity_lost', 'opportunity_reopened',
          'opportunity_archived', 'opportunity_updated'
        )),
        CONSTRAINT "CK_agency_sales_opportunity_events_actor" CHECK ("actor_type" IN ('user', 'system'))
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_agency_sales_opportunity_events_idempotency"
        ON "agency_sales_opportunity_events" ("tenant_id", "workspace_id", "idempotency_key")
        WHERE "idempotency_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agency_sales_opportunity_events_scope_time"
        ON "agency_sales_opportunity_events" ("tenant_id", "workspace_id", "occurred_at", "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agency_sales_opportunity_events_opportunity"
        ON "agency_sales_opportunity_events" ("opportunity_id", "occurred_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "agency_sales_opportunity_events"`,
    );
  }
}
