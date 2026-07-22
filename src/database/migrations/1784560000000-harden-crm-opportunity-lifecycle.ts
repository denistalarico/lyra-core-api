import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenCrmOpportunityLifecycle1784560000000 implements MigrationInterface {
  name = 'HardenCrmOpportunityLifecycle1784560000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "crm_opportunities"
      ADD COLUMN IF NOT EXISTS "row_version" integer NOT NULL DEFAULT 1
    `);

    await queryRunner.query(`
      ALTER TABLE "crm_opportunity_events"
      ADD COLUMN IF NOT EXISTS "actor_agent_id" uuid,
      ADD COLUMN IF NOT EXISTS "event_version" integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(180),
      ADD COLUMN IF NOT EXISTS "correlation_id" uuid,
      ADD COLUMN IF NOT EXISTS "causation_id" uuid,
      ADD COLUMN IF NOT EXISTS "policy_version" varchar(80)
    `);

    await queryRunner.query(`
      UPDATE "crm_opportunity_events"
      SET "correlation_id" = "id"
      WHERE "correlation_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_opportunity_events"
      ALTER COLUMN "correlation_id" SET NOT NULL
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "crm_opportunity_events" event
          JOIN "crm_opportunities" opportunity ON opportunity."id" = event."opportunity_id"
          WHERE event."tenant_id" <> opportunity."tenant_id"
             OR event."workspace_id" <> opportunity."workspace_id"
        ) THEN
          RAISE EXCEPTION 'crm_opportunity_events contains cross-scope history; reconcile before applying 178456';
        END IF;
      END
      $$
    `);

    await queryRunner.query(`
      ALTER TABLE "crm_opportunities"
      ADD CONSTRAINT "uq_crm_opportunities_scope_id"
      UNIQUE ("tenant_id", "workspace_id", "id")
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_opportunity_events"
      DROP CONSTRAINT IF EXISTS "fk_crm_opportunity_events_opportunity"
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_opportunity_events"
      ADD CONSTRAINT "fk_crm_opportunity_events_opportunity_scope"
      FOREIGN KEY ("tenant_id", "workspace_id", "opportunity_id")
      REFERENCES "crm_opportunities" ("tenant_id", "workspace_id", "id")
      ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_crm_opportunity_events_idempotency_type"
      ON "crm_opportunity_events"
        ("tenant_id", "workspace_id", "idempotency_key", "event_type")
      WHERE "idempotency_key" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_crm_opportunity_events_correlation"
      ON "crm_opportunity_events" ("tenant_id", "workspace_id", "correlation_id", "created_at")
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "prevent_crm_opportunity_event_mutation"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'crm_opportunity_events is append-only';
      END
      $$
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_crm_opportunity_events_append_only"
      ON "crm_opportunity_events"
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_crm_opportunity_events_append_only"
      BEFORE UPDATE OR DELETE ON "crm_opportunity_events"
      FOR EACH ROW EXECUTE FUNCTION "prevent_crm_opportunity_event_mutation"()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_crm_opportunity_events_append_only"
      ON "crm_opportunity_events"
    `);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS "prevent_crm_opportunity_event_mutation"()`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_crm_opportunity_events_correlation"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_crm_opportunity_events_idempotency_type"`,
    );
    await queryRunner.query(`
      ALTER TABLE "crm_opportunity_events"
      DROP CONSTRAINT IF EXISTS "fk_crm_opportunity_events_opportunity_scope"
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_opportunity_events"
      ADD CONSTRAINT "fk_crm_opportunity_events_opportunity"
      FOREIGN KEY ("opportunity_id") REFERENCES "crm_opportunities"("id")
      ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_opportunities"
      DROP CONSTRAINT IF EXISTS "uq_crm_opportunities_scope_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_opportunity_events"
      DROP COLUMN IF EXISTS "policy_version",
      DROP COLUMN IF EXISTS "causation_id",
      DROP COLUMN IF EXISTS "correlation_id",
      DROP COLUMN IF EXISTS "idempotency_key",
      DROP COLUMN IF EXISTS "event_version",
      DROP COLUMN IF EXISTS "actor_agent_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_opportunities"
      DROP COLUMN IF EXISTS "row_version"
    `);
  }
}
