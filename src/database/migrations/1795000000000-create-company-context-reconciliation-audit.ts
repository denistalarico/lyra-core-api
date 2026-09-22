import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CC2G — durable audit for legacy reconciliation.
 *
 * Every manual assignment of a `legacy_unassigned` root to a Company Context
 * is recorded here. The table is append-only by contract: reconciliation never
 * updates or deletes rows, so the history survives a later reassignment
 * workflow (CC2G does not implement one).
 *
 * `previous_company_context_id` is always NULL today — CC2G only assigns rows
 * that are still legacy — but the column exists so a future reassignment can
 * reuse the same log instead of inventing a second one.
 *
 * FKs are deliberately partial: `assigned_company_context_id` points at the
 * Company Context with ON DELETE RESTRICT so history cannot be orphaned by
 * deleting a context, while `row_id` is intentionally NOT a foreign key —
 * it addresses ~22 different tables and the domain owns its own lifecycle.
 */
export class CreateCompanyContextReconciliationAudit1795000000000
  implements MigrationInterface
{
  name = 'CreateCompanyContextReconciliationAudit1795000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "company_context_reconciliation_audits" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "domain_key" varchar(120) NOT NULL,
        "row_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "previous_company_context_id" uuid,
        "assigned_company_context_id" uuid NOT NULL,
        "actor_user_id" uuid NOT NULL,
        "reason" text NOT NULL,
        "evidence" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_company_context_reconciliation_audits" PRIMARY KEY ("id"),
        CONSTRAINT "CK_company_context_reconciliation_audits_reason"
          CHECK (btrim("reason") <> ''),
        CONSTRAINT "CK_company_context_reconciliation_audits_transition"
          CHECK ("previous_company_context_id" IS DISTINCT FROM "assigned_company_context_id"),
        CONSTRAINT "FK_company_context_reconciliation_audits_company"
          FOREIGN KEY ("assigned_company_context_id")
          REFERENCES "agency_client_company_contexts"("id") ON DELETE RESTRICT
      );
    `);

    // Reading the history of one row, and the "was this already reconciled?"
    // lookup, both go through (domain_key, row_id).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_company_context_reconciliation_audits_row"
      ON "company_context_reconciliation_audits" ("domain_key", "row_id");
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_company_context_reconciliation_audits_scope"
      ON "company_context_reconciliation_audits"
        ("tenant_id", "workspace_id", "created_at");
    `);

    /**
     * One winner per row. CC2G's assignment endpoint is not a reassignment
     * workflow: a second admin acting on the same row must lose. The service
     * already re-reads the root under a pessimistic lock inside the same
     * transaction, but this index makes the rule true at the database level
     * even if a future caller forgets the lock.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_company_context_reconciliation_audits_row"
      ON "company_context_reconciliation_audits" ("domain_key", "row_id")
      WHERE "previous_company_context_id" IS NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_company_context_reconciliation_audits_row"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_company_context_reconciliation_audits_scope"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_company_context_reconciliation_audits_row"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "company_context_reconciliation_audits"`,
    );
  }
}
