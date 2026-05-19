import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencySalesCore1760001002000 implements MigrationInterface {
  name = 'CreateAgencySalesCore1760001002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_sales_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "description" text,
        "type" varchar(30) NOT NULL DEFAULT 'service',
        "category" varchar(40),
        "billing_type" varchar(30) NOT NULL DEFAULT 'one_time',
        "currency" varchar(10) NOT NULL DEFAULT 'BRL',
        "unit_price_cents" int NOT NULL DEFAULT 0,
        "setup_price_cents" int NOT NULL DEFAULT 0,
        "recurring_price_cents" int NOT NULL DEFAULT 0,
        "recurrence_interval" varchar(20),
        "status" varchar(30) NOT NULL DEFAULT 'active',
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_sales_items_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_sales_pipelines" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "status" varchar(30) NOT NULL DEFAULT 'active',
        "is_default" boolean NOT NULL DEFAULT false,
        "position" int NOT NULL DEFAULT 0,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_sales_pipelines_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_sales_stages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "pipeline_id" uuid NOT NULL,
        "name" varchar(100) NOT NULL,
        "type" varchar(30) NOT NULL DEFAULT 'new',
        "position" int NOT NULL DEFAULT 0,
        "probability" int NOT NULL DEFAULT 0,
        "is_closed" boolean NOT NULL DEFAULT false,
        "is_won" boolean NOT NULL DEFAULT false,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_sales_stages_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_agency_sales_stages_pipeline"
          FOREIGN KEY ("pipeline_id")
          REFERENCES "agency_sales_pipelines" ("id")
          ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_sales_opportunities" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "title" varchar(160) NOT NULL,
        "description" text,
        "pipeline_id" uuid NOT NULL,
        "stage_id" uuid NOT NULL,
        "contact_id" uuid,
        "company_contact_id" uuid,
        "owner_user_id" uuid,
        "amount_cents" int NOT NULL DEFAULT 0,
        "recurring_amount_cents" int NOT NULL DEFAULT 0,
        "currency" varchar(10) NOT NULL DEFAULT 'BRL',
        "status" varchar(30) NOT NULL DEFAULT 'open',
        "expected_close_date" date,
        "closed_at" timestamptz,
        "lost_reason" varchar(160),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_sales_opportunities_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_agency_sales_opportunities_pipeline"
          FOREIGN KEY ("pipeline_id")
          REFERENCES "agency_sales_pipelines" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "fk_agency_sales_opportunities_stage"
          FOREIGN KEY ("stage_id")
          REFERENCES "agency_sales_stages" ("id")
          ON DELETE RESTRICT
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_sales_items_tenant_workspace"
      ON "agency_sales_items" (tenant_id, workspace_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_sales_items_status"
      ON "agency_sales_items" (tenant_id, workspace_id, status);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_sales_pipelines_tenant_workspace"
      ON "agency_sales_pipelines" (tenant_id, workspace_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_sales_stages_pipeline"
      ON "agency_sales_stages" (pipeline_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_sales_stages_tenant_workspace"
      ON "agency_sales_stages" (tenant_id, workspace_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_sales_opportunities_tenant_workspace"
      ON "agency_sales_opportunities" (tenant_id, workspace_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_sales_opportunities_pipeline_stage"
      ON "agency_sales_opportunities" (pipeline_id, stage_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_sales_opportunities_contact"
      ON "agency_sales_opportunities" (contact_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_sales_opportunities_contact";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_sales_opportunities_pipeline_stage";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_sales_opportunities_tenant_workspace";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_sales_stages_tenant_workspace";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_sales_stages_pipeline";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_sales_pipelines_tenant_workspace";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_sales_items_status";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_sales_items_tenant_workspace";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_sales_opportunities";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_sales_stages";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_sales_pipelines";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_sales_items";`);
  }
}
