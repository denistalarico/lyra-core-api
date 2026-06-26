import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the persistence needed for automatic ledger posting on the existing
 * finance_journal_entries header:
 *  - source_line_id  -> ties an entry to a specific source line (e.g. a payment
 *                       allocation) so partial settlements stay idempotent.
 *  - event_type      -> the business event that produced the entry
 *                       (invoice_confirmed, bill_confirmed, ...).
 *  - idempotency_key  -> persistent dedup key
 *                       (tenant:workspace:sourceType:sourceId:sourceLineId:event).
 *  - reverses_entry_id -> links a reversal entry back to the original it cancels.
 *
 * All columns are nullable so manual journal entries are unaffected. The unique
 * index is partial (only rows that carry a key) to avoid constraining manual
 * entries while guaranteeing automatic postings never duplicate.
 */
export class AddFinanceJournalEntryPostingFields1782600000000
  implements MigrationInterface
{
  name = 'AddFinanceJournalEntryPostingFields1782600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "finance_journal_entries"
        ADD COLUMN IF NOT EXISTS "source_line_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "event_type" varchar(60) NULL,
        ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(220) NULL,
        ADD COLUMN IF NOT EXISTS "reverses_entry_id" uuid NULL;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_finance_journal_entries_idempotency"
        ON "finance_journal_entries" ("tenant_id", "workspace_id", "idempotency_key")
        WHERE "idempotency_key" IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_finance_journal_entries_source"
        ON "finance_journal_entries" ("tenant_id", "workspace_id", "source_module", "source_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_finance_journal_entries_source"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_finance_journal_entries_idempotency"`);
    await queryRunner.query(`
      ALTER TABLE "finance_journal_entries"
        DROP COLUMN IF EXISTS "reverses_entry_id",
        DROP COLUMN IF EXISTS "idempotency_key",
        DROP COLUMN IF EXISTS "event_type",
        DROP COLUMN IF EXISTS "source_line_id";
    `);
  }
}
