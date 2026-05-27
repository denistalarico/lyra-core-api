import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyFinanceDocumentSequences1760002018000
  implements MigrationInterface
{
  name = 'CreateAgencyFinanceDocumentSequences1760002018000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "finance_document_sequences_document_type_enum" AS ENUM (
        'invoice',
        'bill',
        'payment',
        'receipt',
        'journal_entry',
        'fiscal_document'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_document_sequences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "document_type" "finance_document_sequences_document_type_enum" NOT NULL,
        "period_year" integer NOT NULL,
        "prefix" varchar(20) NOT NULL,
        "next_number" integer NOT NULL DEFAULT 1,
        "padding" integer NOT NULL DEFAULT 6,
        "last_generated_number" varchar(80),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_document_sequences" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_finance_document_sequences_scope"
      ON "finance_document_sequences" (
        "tenant_id",
        "workspace_id",
        "document_type",
        "period_year"
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_finance_document_sequences_lookup"
      ON "finance_document_sequences" (
        "tenant_id",
        "workspace_id",
        "document_type"
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_finance_document_sequences_lookup"`);
    await queryRunner.query(`DROP INDEX "UQ_finance_document_sequences_scope"`);
    await queryRunner.query(`DROP TABLE "finance_document_sequences"`);
    await queryRunner.query(`DROP TYPE "finance_document_sequences_document_type_enum"`);
  }
}
