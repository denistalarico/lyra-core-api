import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CS6-B — `ai_operational_costs`, the provider-neutral ledger of paid AI
 * operations that Finance/Profitability consumes.
 *
 * One row per paid provider operation, keyed by its source
 * (`UQ_ai_operational_costs_source`): replays, recoveries and concurrent
 * reconciles collapse into the same row. Vocabulary that is the ledger's own
 * (status, source, outcome, unknown reason) is CHECKed; provider, model and
 * operation kinds are free text, so a new provider needs no migration.
 *
 * `TR_ai_operational_costs_immutable` keeps every economic column as written.
 * The single allowed transition is `unknown → known` (a price version or a
 * reconciliation arrived); a `known` row never changes amount, currency,
 * source or pricing. Correlation columns are a projection and stay writable.
 *
 * No foreign keys: a hard-deleted task, project or content item must not
 * delete or block a cost. No backfill here: the producing domain materializes
 * history with the same code path it uses live (deterministic from its own
 * rows and versioned price tables), so there is exactly one way a row is made.
 * For the same reason `down` may drop the table: every row is re-derivable.
 *
 * Every statement is re-runnable (specs call `up()` against migrated schemas).
 */
export class CreateAiOperationalCosts1799000000000 implements MigrationInterface {
  name = 'CreateAiOperationalCosts1799000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ai_operational_costs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "company_context_id" uuid,
        "source_domain" varchar(60) NOT NULL,
        "source_type" varchar(60) NOT NULL,
        "source_id" varchar(160) NOT NULL,
        "logical_type" varchar(60) NOT NULL,
        "logical_id" varchar(160) NOT NULL,
        "operation_kind" varchar(60) NOT NULL,
        "provider" varchar(80) NOT NULL,
        "model" varchar(160),
        "outcome" varchar(16) NOT NULL,
        "usage_unit" varchar(80),
        "usage_quantity" numeric(20,6),
        "usage_metrics" jsonb,
        "unit_price" numeric(18,8),
        "pricing_version" varchar(80),
        "cost_status" varchar(16) NOT NULL,
        "provider_cost" numeric(18,6),
        "provider_currency" char(3),
        "cost_source" varchar(24),
        "unknown_reason" varchar(40),
        "occurred_at" timestamptz NOT NULL,
        "content_item_id" uuid,
        "project_id" uuid,
        "task_id" uuid,
        "correlated_at" timestamptz,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_ai_operational_costs_source"
          UNIQUE ("source_domain", "source_type", "source_id"),
        CONSTRAINT "CK_ai_operational_costs_scope"
          CHECK ("company_context_id" IS NULL OR "agency_client_id" IS NOT NULL),
        CONSTRAINT "CK_ai_operational_costs_outcome"
          CHECK ("outcome" IN ('succeeded', 'failed')),
        CONSTRAINT "CK_ai_operational_costs_status"
          CHECK ("cost_status" IN ('known', 'unknown')),
        CONSTRAINT "CK_ai_operational_costs_source_vocabulary"
          CHECK ("cost_source" IS NULL OR "cost_source" IN
            ('provider_reported', 'lyra_calculated', 'estimated', 'reconciled')),
        CONSTRAINT "CK_ai_operational_costs_unknown_reason"
          CHECK ("unknown_reason" IS NULL OR "unknown_reason" IN
            ('outcome_unknown', 'usage_missing', 'unpriced')),
        CONSTRAINT "CK_ai_operational_costs_known"
          CHECK (
            ("cost_status" = 'known'
              AND "provider_cost" IS NOT NULL AND "provider_cost" >= 0
              AND "provider_currency" ~ '^[A-Z]{3}$'
              AND "cost_source" IS NOT NULL AND "unknown_reason" IS NULL)
            OR
            ("cost_status" = 'unknown'
              AND "provider_cost" IS NULL AND "provider_currency" IS NULL
              AND "cost_source" IS NULL AND "unknown_reason" IS NOT NULL)
          ),
        CONSTRAINT "CK_ai_operational_costs_usage_quantity"
          CHECK ("usage_quantity" IS NULL OR "usage_quantity" >= 0),
        CONSTRAINT "CK_ai_operational_costs_unit_price"
          CHECK ("unit_price" IS NULL OR "unit_price" >= 0)
      )`);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_operational_costs_period"
        ON "ai_operational_costs" ("tenant_id", "workspace_id", "occurred_at")`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_operational_costs_client"
        ON "ai_operational_costs"
          ("tenant_id", "workspace_id", "agency_client_id", "occurred_at")`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_operational_costs_project"
        ON "ai_operational_costs" ("tenant_id", "workspace_id", "project_id")
        WHERE "project_id" IS NOT NULL`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_operational_costs_task"
        ON "ai_operational_costs" ("tenant_id", "workspace_id", "task_id")
        WHERE "task_id" IS NOT NULL`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_operational_costs_content_item"
        ON "ai_operational_costs" ("tenant_id", "workspace_id", "content_item_id")
        WHERE "content_item_id" IS NOT NULL`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_operational_costs_logical"
        ON "ai_operational_costs" ("source_domain", "logical_type", "logical_id")`);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION guard_ai_operational_cost_immutable()
      RETURNS trigger AS $$
      BEGIN
        IF (NEW."tenant_id", NEW."workspace_id", NEW."agency_client_id",
            NEW."company_context_id", NEW."source_domain", NEW."source_type",
            NEW."source_id", NEW."logical_type", NEW."logical_id",
            NEW."operation_kind", NEW."provider", NEW."model", NEW."outcome",
            NEW."occurred_at", NEW."created_at")
           IS DISTINCT FROM
           (OLD."tenant_id", OLD."workspace_id", OLD."agency_client_id",
            OLD."company_context_id", OLD."source_domain", OLD."source_type",
            OLD."source_id", OLD."logical_type", OLD."logical_id",
            OLD."operation_kind", OLD."provider", OLD."model", OLD."outcome",
            OLD."occurred_at", OLD."created_at") THEN
          RAISE EXCEPTION 'ai operational cost identity is immutable'
            USING ERRCODE = '23514', CONSTRAINT = 'TR_ai_operational_costs_immutable';
        END IF;
        IF (NEW."cost_status", NEW."provider_cost", NEW."provider_currency",
            NEW."cost_source", NEW."unknown_reason", NEW."pricing_version",
            NEW."unit_price", NEW."usage_unit", NEW."usage_quantity",
            NEW."usage_metrics")
           IS DISTINCT FROM
           (OLD."cost_status", OLD."provider_cost", OLD."provider_currency",
            OLD."cost_source", OLD."unknown_reason", OLD."pricing_version",
            OLD."unit_price", OLD."usage_unit", OLD."usage_quantity",
            OLD."usage_metrics")
           AND NOT (OLD."cost_status" = 'unknown' AND NEW."cost_status" = 'known') THEN
          RAISE EXCEPTION 'a recorded ai cost cannot change (only unknown -> known)'
            USING ERRCODE = '23514', CONSTRAINT = 'TR_ai_operational_costs_immutable';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_ai_operational_costs_immutable" ON "ai_operational_costs"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_ai_operational_costs_immutable"
        BEFORE UPDATE ON "ai_operational_costs"
        FOR EACH ROW EXECUTE FUNCTION guard_ai_operational_cost_immutable()`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_ai_operational_costs_immutable" ON "ai_operational_costs"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS guard_ai_operational_cost_immutable()',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "ai_operational_costs"');
  }
}
