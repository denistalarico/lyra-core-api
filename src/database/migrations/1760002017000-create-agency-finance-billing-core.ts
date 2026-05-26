import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyFinanceBillingCore1760002017000
  implements MigrationInterface
{
  name = 'CreateAgencyFinanceBillingCore1760002017000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "finance_invoices_status_enum" AS ENUM (
        'draft',
        'issued',
        'partially_paid',
        'paid',
        'overdue',
        'cancelled',
        'void'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_bills_status_enum" AS ENUM (
        'draft',
        'open',
        'partially_paid',
        'paid',
        'overdue',
        'cancelled'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_payments_direction_enum" AS ENUM (
        'customer',
        'vendor'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_payments_status_enum" AS ENUM (
        'draft',
        'pending',
        'completed',
        'failed',
        'cancelled',
        'refunded'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_payments_method_enum" AS ENUM (
        'manual',
        'bank_transfer',
        'pix',
        'cash',
        'credit_card',
        'debit_card',
        'stripe',
        'mercado_pago',
        'asaas',
        'cobre_facil',
        'other'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_payment_allocations_target_type_enum" AS ENUM (
        'invoice',
        'bill'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_recurring_profiles_status_enum" AS ENUM (
        'draft',
        'active',
        'paused',
        'cancelled',
        'completed'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_recurring_profiles_interval_enum" AS ENUM (
        'weekly',
        'monthly',
        'quarterly',
        'semiannual',
        'yearly'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_invoices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "customer_id" uuid,
        "source_module" varchar(80),
        "source_id" uuid,
        "invoice_number" varchar(80) NOT NULL,
        "status" "finance_invoices_status_enum" NOT NULL DEFAULT 'draft',
        "currency" varchar(3) NOT NULL DEFAULT 'BRL',
        "issue_date" date,
        "due_date" date,
        "period_start" date,
        "period_end" date,
        "subtotal_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "tax_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "discount_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "total_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "paid_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "balance_due" numeric(14,2) NOT NULL DEFAULT 0,
        "terms" text,
        "notes" text,
        "issued_at" timestamptz,
        "paid_at" timestamptz,
        "cancelled_at" timestamptz,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_invoices" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_invoice_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "invoice_id" uuid NOT NULL,
        "product_id" uuid,
        "service_id" uuid,
        "description" varchar(255) NOT NULL,
        "quantity" numeric(14,4) NOT NULL DEFAULT 1,
        "unit_price" numeric(14,2) NOT NULL DEFAULT 0,
        "discount_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "tax_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "total_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "category_id" uuid,
        "cost_center_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_invoice_lines" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_bills" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "vendor_id" uuid,
        "bill_number" varchar(80) NOT NULL,
        "status" "finance_bills_status_enum" NOT NULL DEFAULT 'draft',
        "currency" varchar(3) NOT NULL DEFAULT 'BRL',
        "issue_date" date,
        "due_date" date,
        "period_start" date,
        "period_end" date,
        "subtotal_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "tax_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "total_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "paid_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "balance_due" numeric(14,2) NOT NULL DEFAULT 0,
        "category_id" uuid,
        "cost_center_id" uuid,
        "notes" text,
        "paid_at" timestamptz,
        "cancelled_at" timestamptz,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_bills" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_bill_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "bill_id" uuid NOT NULL,
        "description" varchar(255) NOT NULL,
        "quantity" numeric(14,4) NOT NULL DEFAULT 1,
        "unit_price" numeric(14,2) NOT NULL DEFAULT 0,
        "tax_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "total_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "category_id" uuid,
        "cost_center_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_bill_lines" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_payments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "direction" "finance_payments_direction_enum" NOT NULL,
        "status" "finance_payments_status_enum" NOT NULL DEFAULT 'completed',
        "method" "finance_payments_method_enum" NOT NULL DEFAULT 'manual',
        "contact_id" uuid,
        "bank_account_id" uuid,
        "payment_date" date NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "allocated_amount" numeric(14,2) NOT NULL DEFAULT 0,
        "currency" varchar(3) NOT NULL DEFAULT 'BRL',
        "external_provider" varchar(80),
        "external_reference" varchar(180),
        "description" varchar(255),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_payments" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_payment_allocations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "payment_id" uuid NOT NULL,
        "target_type" "finance_payment_allocations_target_type_enum" NOT NULL,
        "target_id" uuid NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_payment_allocations" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_recurring_profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "customer_id" uuid,
        "source_module" varchar(80),
        "source_id" uuid,
        "name" varchar(160) NOT NULL,
        "status" "finance_recurring_profiles_status_enum" NOT NULL DEFAULT 'draft',
        "interval" "finance_recurring_profiles_interval_enum" NOT NULL DEFAULT 'monthly',
        "amount" numeric(14,2) NOT NULL,
        "currency" varchar(3) NOT NULL DEFAULT 'BRL',
        "start_date" date NOT NULL,
        "end_date" date,
        "next_invoice_date" date,
        "last_invoice_date" date,
        "auto_generate_invoice" boolean NOT NULL DEFAULT true,
        "category_id" uuid,
        "cost_center_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_recurring_profiles" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_finance_invoices_number_tenant_workspace" ON "finance_invoices" ("tenant_id", "workspace_id", "invoice_number")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_finance_bills_number_tenant_workspace" ON "finance_bills" ("tenant_id", "workspace_id", "bill_number")`);

    await queryRunner.query(`CREATE INDEX "IDX_finance_invoices_tenant_workspace_status" ON "finance_invoices" ("tenant_id", "workspace_id", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_invoices_due_date" ON "finance_invoices" ("tenant_id", "workspace_id", "due_date")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_bills_tenant_workspace_status" ON "finance_bills" ("tenant_id", "workspace_id", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_bills_due_date" ON "finance_bills" ("tenant_id", "workspace_id", "due_date")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_payments_lookup" ON "finance_payments" ("tenant_id", "workspace_id", "direction", "payment_date")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_payment_allocations_lookup" ON "finance_payment_allocations" ("tenant_id", "workspace_id", "target_type", "target_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_recurring_profiles_lookup" ON "finance_recurring_profiles" ("tenant_id", "workspace_id", "status", "next_invoice_date")`);

    await queryRunner.query(`
      ALTER TABLE "finance_invoice_lines"
      ADD CONSTRAINT "FK_finance_invoice_lines_invoice"
      FOREIGN KEY ("invoice_id") REFERENCES "finance_invoices"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "finance_bill_lines"
      ADD CONSTRAINT "FK_finance_bill_lines_bill"
      FOREIGN KEY ("bill_id") REFERENCES "finance_bills"("id")
      ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "finance_payment_allocations"
      ADD CONSTRAINT "FK_finance_payment_allocations_payment"
      FOREIGN KEY ("payment_id") REFERENCES "finance_payments"("id")
      ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "finance_payment_allocations" DROP CONSTRAINT "FK_finance_payment_allocations_payment"`);
    await queryRunner.query(`ALTER TABLE "finance_bill_lines" DROP CONSTRAINT "FK_finance_bill_lines_bill"`);
    await queryRunner.query(`ALTER TABLE "finance_invoice_lines" DROP CONSTRAINT "FK_finance_invoice_lines_invoice"`);

    await queryRunner.query(`DROP INDEX "IDX_finance_recurring_profiles_lookup"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_payment_allocations_lookup"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_payments_lookup"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_bills_due_date"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_bills_tenant_workspace_status"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_invoices_due_date"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_invoices_tenant_workspace_status"`);
    await queryRunner.query(`DROP INDEX "UQ_finance_bills_number_tenant_workspace"`);
    await queryRunner.query(`DROP INDEX "UQ_finance_invoices_number_tenant_workspace"`);

    await queryRunner.query(`DROP TABLE "finance_recurring_profiles"`);
    await queryRunner.query(`DROP TABLE "finance_payment_allocations"`);
    await queryRunner.query(`DROP TABLE "finance_payments"`);
    await queryRunner.query(`DROP TABLE "finance_bill_lines"`);
    await queryRunner.query(`DROP TABLE "finance_bills"`);
    await queryRunner.query(`DROP TABLE "finance_invoice_lines"`);
    await queryRunner.query(`DROP TABLE "finance_invoices"`);

    await queryRunner.query(`DROP TYPE "finance_recurring_profiles_interval_enum"`);
    await queryRunner.query(`DROP TYPE "finance_recurring_profiles_status_enum"`);
    await queryRunner.query(`DROP TYPE "finance_payment_allocations_target_type_enum"`);
    await queryRunner.query(`DROP TYPE "finance_payments_method_enum"`);
    await queryRunner.query(`DROP TYPE "finance_payments_status_enum"`);
    await queryRunner.query(`DROP TYPE "finance_payments_direction_enum"`);
    await queryRunner.query(`DROP TYPE "finance_bills_status_enum"`);
    await queryRunner.query(`DROP TYPE "finance_invoices_status_enum"`);
  }
}
