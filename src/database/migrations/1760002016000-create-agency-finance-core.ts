import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyFinanceCore1760002016000 implements MigrationInterface {
  name = 'CreateAgencyFinanceCore1760002016000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "finance_accounts_type_enum" AS ENUM (
        'asset',
        'liability',
        'equity',
        'revenue',
        'expense',
        'cost_of_goods_sold'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_accounts_status_enum" AS ENUM (
        'active',
        'archived'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_journals_type_enum" AS ENUM (
        'sales',
        'purchase',
        'bank',
        'cash',
        'credit_card',
        'miscellaneous'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_categories_type_enum" AS ENUM (
        'revenue',
        'expense',
        'cost',
        'tax',
        'transfer'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_categories_cost_behavior_enum" AS ENUM (
        'fixed',
        'variable',
        'mixed'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_cost_centers_type_enum" AS ENUM (
        'client',
        'project',
        'team',
        'department',
        'internal',
        'commercial',
        'administrative',
        'other'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_bank_accounts_type_enum" AS ENUM (
        'checking',
        'savings',
        'cash',
        'credit_card',
        'payment_provider',
        'other'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_periods_status_enum" AS ENUM (
        'open',
        'closed',
        'locked'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_metric_snapshots_metric_key_enum" AS ENUM (
        'mrr',
        'revenue_issued',
        'revenue_received',
        'open_receivables',
        'overdue_receivables',
        'default_rate',
        'average_ticket',
        'fixed_costs',
        'variable_costs',
        'gross_margin',
        'net_margin',
        'break_even_point',
        'active_contracts',
        'customer_churn',
        'revenue_churn'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_metric_snapshots_period_type_enum" AS ENUM (
        'daily',
        'weekly',
        'monthly',
        'quarterly',
        'yearly',
        'custom'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_report_snapshots_report_type_enum" AS ENUM (
        'executive',
        'revenue',
        'receivables',
        'expenses',
        'profit_and_loss',
        'retention',
        'profitability'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "finance_report_snapshots_period_type_enum" AS ENUM (
        'daily',
        'weekly',
        'monthly',
        'quarterly',
        'yearly',
        'custom'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "base_currency" varchar(3) NOT NULL DEFAULT 'BRL',
        "fiscal_country" varchar(2) NOT NULL DEFAULT 'BR',
        "fiscal_localization" varchar(80) NOT NULL DEFAULT 'br_agency_simplified',
        "default_payment_terms_days" integer NOT NULL DEFAULT 7,
        "invoice_terms" text,
        "pix_enabled" boolean NOT NULL DEFAULT false,
        "pix_key" varchar(180),
        "auto_generate_recurring_invoices" boolean NOT NULL DEFAULT false,
        "grace_period_days" integer NOT NULL DEFAULT 3,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_settings" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "code" varchar(40) NOT NULL,
        "name" varchar(160) NOT NULL,
        "type" "finance_accounts_type_enum" NOT NULL,
        "status" "finance_accounts_status_enum" NOT NULL DEFAULT 'active',
        "parent_id" uuid,
        "is_system" boolean NOT NULL DEFAULT false,
        "description" text,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_accounts" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_journals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "code" varchar(40) NOT NULL,
        "type" "finance_journals_type_enum" NOT NULL,
        "default_debit_account_id" uuid,
        "default_credit_account_id" uuid,
        "active" boolean NOT NULL DEFAULT true,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_journals" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_categories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "type" "finance_categories_type_enum" NOT NULL,
        "cost_behavior" "finance_categories_cost_behavior_enum",
        "account_id" uuid,
        "color" varchar(24),
        "active" boolean NOT NULL DEFAULT true,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_categories" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_tags" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "color" varchar(24),
        "active" boolean NOT NULL DEFAULT true,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_tags" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_cost_centers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "type" "finance_cost_centers_type_enum" NOT NULL DEFAULT 'other',
        "related_entity_type" varchar(80),
        "related_entity_id" uuid,
        "active" boolean NOT NULL DEFAULT true,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_cost_centers" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_bank_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "type" "finance_bank_accounts_type_enum" NOT NULL DEFAULT 'checking',
        "currency" varchar(3) NOT NULL DEFAULT 'BRL',
        "bank_name" varchar(160),
        "external_reference" varchar(180),
        "opening_balance" numeric(14,2) NOT NULL DEFAULT 0,
        "active" boolean NOT NULL DEFAULT true,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_bank_accounts" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_periods" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,
        "status" "finance_periods_status_enum" NOT NULL DEFAULT 'open',
        "closed_at" timestamptz,
        "closed_by_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_periods" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_metric_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "metric_key" "finance_metric_snapshots_metric_key_enum" NOT NULL,
        "period_type" "finance_metric_snapshots_period_type_enum" NOT NULL DEFAULT 'monthly',
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,
        "value" numeric(16,4) NOT NULL DEFAULT 0,
        "currency" varchar(3),
        "source" varchar(80) NOT NULL DEFAULT 'system',
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "calculated_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_metric_snapshots" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_report_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "report_type" "finance_report_snapshots_report_type_enum" NOT NULL,
        "period_type" "finance_report_snapshots_period_type_enum" NOT NULL DEFAULT 'monthly',
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "calculated_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_report_snapshots" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "finance_profitability_rules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "default_hourly_cost" numeric(14,2) NOT NULL DEFAULT 0,
        "healthy_margin_threshold" numeric(8,4) NOT NULL DEFAULT 0.4,
        "attention_margin_threshold" numeric(8,4) NOT NULL DEFAULT 0.2,
        "risk_margin_threshold" numeric(8,4) NOT NULL DEFAULT 0,
        "overhead_allocation_method" varchar(80) NOT NULL DEFAULT 'revenue_share',
        "include_fixed_costs_in_client_margin" boolean NOT NULL DEFAULT true,
        "include_team_time_costs" boolean NOT NULL DEFAULT true,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_profitability_rules" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_finance_settings_tenant_workspace" ON "finance_settings" ("tenant_id", "workspace_id")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_finance_accounts_code_tenant_workspace" ON "finance_accounts" ("tenant_id", "workspace_id", "code")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_finance_journals_code_tenant_workspace" ON "finance_journals" ("tenant_id", "workspace_id", "code")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_finance_categories_name_tenant_workspace" ON "finance_categories" ("tenant_id", "workspace_id", "name", "type")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_finance_tags_name_tenant_workspace" ON "finance_tags" ("tenant_id", "workspace_id", "name")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_finance_cost_centers_name_tenant_workspace" ON "finance_cost_centers" ("tenant_id", "workspace_id", "name", "type")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_finance_periods_tenant_workspace_dates" ON "finance_periods" ("tenant_id", "workspace_id", "period_start", "period_end")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_finance_profitability_rules_tenant_workspace" ON "finance_profitability_rules" ("tenant_id", "workspace_id")`);

    await queryRunner.query(`CREATE INDEX "IDX_finance_accounts_tenant_workspace" ON "finance_accounts" ("tenant_id", "workspace_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_journals_tenant_workspace" ON "finance_journals" ("tenant_id", "workspace_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_categories_tenant_workspace" ON "finance_categories" ("tenant_id", "workspace_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_tags_tenant_workspace" ON "finance_tags" ("tenant_id", "workspace_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_cost_centers_tenant_workspace" ON "finance_cost_centers" ("tenant_id", "workspace_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_metric_snapshots_lookup" ON "finance_metric_snapshots" ("tenant_id", "workspace_id", "metric_key", "period_start", "period_end")`);
    await queryRunner.query(`CREATE INDEX "IDX_finance_report_snapshots_lookup" ON "finance_report_snapshots" ("tenant_id", "workspace_id", "report_type", "period_start", "period_end")`);

    await queryRunner.query(`
      ALTER TABLE "finance_accounts"
      ADD CONSTRAINT "FK_finance_accounts_parent"
      FOREIGN KEY ("parent_id") REFERENCES "finance_accounts"("id")
      ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "finance_journals"
      ADD CONSTRAINT "FK_finance_journals_default_debit_account"
      FOREIGN KEY ("default_debit_account_id") REFERENCES "finance_accounts"("id")
      ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "finance_journals"
      ADD CONSTRAINT "FK_finance_journals_default_credit_account"
      FOREIGN KEY ("default_credit_account_id") REFERENCES "finance_accounts"("id")
      ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "finance_categories"
      ADD CONSTRAINT "FK_finance_categories_account"
      FOREIGN KEY ("account_id") REFERENCES "finance_accounts"("id")
      ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "finance_categories" DROP CONSTRAINT "FK_finance_categories_account"`);
    await queryRunner.query(`ALTER TABLE "finance_journals" DROP CONSTRAINT "FK_finance_journals_default_credit_account"`);
    await queryRunner.query(`ALTER TABLE "finance_journals" DROP CONSTRAINT "FK_finance_journals_default_debit_account"`);
    await queryRunner.query(`ALTER TABLE "finance_accounts" DROP CONSTRAINT "FK_finance_accounts_parent"`);

    await queryRunner.query(`DROP INDEX "IDX_finance_report_snapshots_lookup"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_metric_snapshots_lookup"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_cost_centers_tenant_workspace"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_tags_tenant_workspace"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_categories_tenant_workspace"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_journals_tenant_workspace"`);
    await queryRunner.query(`DROP INDEX "IDX_finance_accounts_tenant_workspace"`);

    await queryRunner.query(`DROP INDEX "UQ_finance_profitability_rules_tenant_workspace"`);
    await queryRunner.query(`DROP INDEX "UQ_finance_periods_tenant_workspace_dates"`);
    await queryRunner.query(`DROP INDEX "UQ_finance_cost_centers_name_tenant_workspace"`);
    await queryRunner.query(`DROP INDEX "UQ_finance_tags_name_tenant_workspace"`);
    await queryRunner.query(`DROP INDEX "UQ_finance_categories_name_tenant_workspace"`);
    await queryRunner.query(`DROP INDEX "UQ_finance_journals_code_tenant_workspace"`);
    await queryRunner.query(`DROP INDEX "UQ_finance_accounts_code_tenant_workspace"`);
    await queryRunner.query(`DROP INDEX "UQ_finance_settings_tenant_workspace"`);

    await queryRunner.query(`DROP TABLE "finance_profitability_rules"`);
    await queryRunner.query(`DROP TABLE "finance_report_snapshots"`);
    await queryRunner.query(`DROP TABLE "finance_metric_snapshots"`);
    await queryRunner.query(`DROP TABLE "finance_periods"`);
    await queryRunner.query(`DROP TABLE "finance_bank_accounts"`);
    await queryRunner.query(`DROP TABLE "finance_cost_centers"`);
    await queryRunner.query(`DROP TABLE "finance_tags"`);
    await queryRunner.query(`DROP TABLE "finance_categories"`);
    await queryRunner.query(`DROP TABLE "finance_journals"`);
    await queryRunner.query(`DROP TABLE "finance_accounts"`);
    await queryRunner.query(`DROP TABLE "finance_settings"`);

    await queryRunner.query(`DROP TYPE "finance_report_snapshots_period_type_enum"`);
    await queryRunner.query(`DROP TYPE "finance_report_snapshots_report_type_enum"`);
    await queryRunner.query(`DROP TYPE "finance_metric_snapshots_period_type_enum"`);
    await queryRunner.query(`DROP TYPE "finance_metric_snapshots_metric_key_enum"`);
    await queryRunner.query(`DROP TYPE "finance_periods_status_enum"`);
    await queryRunner.query(`DROP TYPE "finance_bank_accounts_type_enum"`);
    await queryRunner.query(`DROP TYPE "finance_cost_centers_type_enum"`);
    await queryRunner.query(`DROP TYPE "finance_categories_cost_behavior_enum"`);
    await queryRunner.query(`DROP TYPE "finance_categories_type_enum"`);
    await queryRunner.query(`DROP TYPE "finance_journals_type_enum"`);
    await queryRunner.query(`DROP TYPE "finance_accounts_status_enum"`);
    await queryRunner.query(`DROP TYPE "finance_accounts_type_enum"`);
  }
}
