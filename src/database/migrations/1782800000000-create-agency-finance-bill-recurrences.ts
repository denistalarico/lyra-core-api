import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyFinanceBillRecurrences1782800000000
  implements MigrationInterface
{
  name = 'CreateAgencyFinanceBillRecurrences1782800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "finance_bill_recurrences_status_enum" AS ENUM (
        'draft',
        'active',
        'paused',
        'cancelled',
        'completed'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_bill_recurrences_frequency_enum" AS ENUM (
        'weekly',
        'biweekly',
        'monthly',
        'quarterly',
        'semiannual',
        'yearly'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_bill_recurrences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "source_bill_id" uuid,
        "vendor_id" uuid,
        "name" varchar(160) NOT NULL,
        "description" text,
        "currency" varchar(3) NOT NULL DEFAULT 'BRL',
        "amount" numeric(14,2) NOT NULL DEFAULT 0,
        "status" "finance_bill_recurrences_status_enum" NOT NULL DEFAULT 'draft',
        "frequency" "finance_bill_recurrences_frequency_enum" NOT NULL DEFAULT 'monthly',
        "interval_count" integer NOT NULL DEFAULT 1,
        "start_date" date NOT NULL,
        "end_date" date,
        "occurrences_limit" integer,
        "occurrences_created" integer NOT NULL DEFAULT 0,
        "next_generation_date" date,
        "generation_day" integer,
        "due_day" integer,
        "generate_as_status" varchar(20) NOT NULL DEFAULT 'draft',
        "category_id" uuid,
        "cost_center_id" uuid,
        "line_template" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "last_generated_at" timestamptz,
        "last_generated_bill_id" uuid,
        "active" boolean NOT NULL DEFAULT true,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_by_id" uuid,
        "updated_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_bill_recurrences" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_finance_bill_recurrences_lookup"
      ON "finance_bill_recurrences" ("tenant_id", "workspace_id", "status", "next_generation_date")
    `);

    // Hard idempotency guard: a recurrence cannot generate two bills for the
    // same competence/occurrence. Generated bills carry the occurrence key in
    // metadata; this partial unique index enforces it at the database level.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_finance_bills_recurrence_occurrence"
      ON "finance_bills" ("tenant_id", "workspace_id", (("metadata" ->> 'recurrenceOccurrenceKey')))
      WHERE ("metadata" ->> 'recurrenceOccurrenceKey') IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_finance_bills_recurrence_occurrence"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_bill_recurrences_lookup"`);
    await queryRunner.query(`DROP TABLE "finance_bill_recurrences"`);
    await queryRunner.query(`DROP TYPE "finance_bill_recurrences_frequency_enum"`);
    await queryRunner.query(`DROP TYPE "finance_bill_recurrences_status_enum"`);
  }
}
