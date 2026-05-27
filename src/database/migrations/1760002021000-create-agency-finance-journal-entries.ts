import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyFinanceJournalEntries1760002021000
  implements MigrationInterface
{
  name = 'CreateAgencyFinanceJournalEntries1760002021000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "finance_journal_entries_status_enum" AS ENUM (
        'draft',
        'posted',
        'cancelled'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_journal_entry_lines_line_type_enum" AS ENUM (
        'debit',
        'credit'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_journal_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "entry_number" varchar(80) NOT NULL,
        "status" "finance_journal_entries_status_enum" NOT NULL DEFAULT 'draft',
        "entry_date" date NOT NULL,
        "description" text,
        "journal_id" uuid,
        "source_module" varchar(80),
        "source_id" uuid,
        "total_debit" numeric(14,2) NOT NULL DEFAULT 0,
        "total_credit" numeric(14,2) NOT NULL DEFAULT 0,
        "posted_at" timestamptz,
        "posted_by_id" uuid,
        "cancelled_at" timestamptz,
        "cancelled_by_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_journal_entries" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_journal_entry_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "journal_entry_id" uuid NOT NULL,
        "line_type" "finance_journal_entry_lines_line_type_enum" NOT NULL,
        "account_id" uuid,
        "category_id" uuid,
        "cost_center_id" uuid,
        "contact_id" uuid,
        "description" text,
        "amount" numeric(14,2) NOT NULL DEFAULT 0,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_journal_entry_lines" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_finance_journal_entries_scope"
      ON "finance_journal_entries" ("tenant_id", "workspace_id", "entry_date")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_finance_journal_entries_number"
      ON "finance_journal_entries" ("tenant_id", "workspace_id", "entry_number")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_finance_journal_entry_lines_entry"
      ON "finance_journal_entry_lines" ("tenant_id", "workspace_id", "journal_entry_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "finance_journal_entry_lines"
      ADD CONSTRAINT "FK_finance_journal_entry_lines_entry"
      FOREIGN KEY ("journal_entry_id")
      REFERENCES "finance_journal_entries"("id")
      ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "finance_journal_entry_lines"
      DROP CONSTRAINT "FK_finance_journal_entry_lines_entry"
    `);
    await queryRunner.query(`DROP INDEX "IDX_finance_journal_entry_lines_entry"`);
    await queryRunner.query(`DROP INDEX "UQ_finance_journal_entries_number"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_journal_entries_scope"`);
    await queryRunner.query(`DROP TABLE "finance_journal_entry_lines"`);
    await queryRunner.query(`DROP TABLE "finance_journal_entries"`);
    await queryRunner.query(`DROP TYPE "finance_journal_entry_lines_line_type_enum"`);
    await queryRunner.query(`DROP TYPE "finance_journal_entries_status_enum"`);
  }
}
