import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencySalesOpportunityItems1760001003000
  implements MigrationInterface
{
  name = 'CreateAgencySalesOpportunityItems1760001003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_sales_opportunity_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "opportunity_id" uuid NOT NULL,
        "sales_item_id" uuid,
        "name" varchar(140) NOT NULL,
        "description" text,
        "type" varchar(30) NOT NULL DEFAULT 'service',
        "category" varchar(40),
        "billing_type" varchar(30) NOT NULL DEFAULT 'one_time',
        "currency" varchar(10) NOT NULL DEFAULT 'BRL',
        "quantity" int NOT NULL DEFAULT 1,
        "unit_price_cents" int NOT NULL DEFAULT 0,
        "setup_price_cents" int NOT NULL DEFAULT 0,
        "recurring_price_cents" int NOT NULL DEFAULT 0,
        "subtotal_cents" int NOT NULL DEFAULT 0,
        "recurring_subtotal_cents" int NOT NULL DEFAULT 0,
        "recurrence_interval" varchar(20),
        "position" int NOT NULL DEFAULT 0,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_sales_opportunity_items_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_agency_sales_opportunity_items_opportunity"
          FOREIGN KEY ("opportunity_id")
          REFERENCES "agency_sales_opportunities" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "fk_agency_sales_opportunity_items_sales_item"
          FOREIGN KEY ("sales_item_id")
          REFERENCES "agency_sales_items" ("id")
          ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_sales_opportunity_items_opportunity"
      ON "agency_sales_opportunity_items" (opportunity_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_sales_opportunity_items_tenant_workspace"
      ON "agency_sales_opportunity_items" (tenant_id, workspace_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_sales_opportunity_items_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_sales_opportunity_items_opportunity";`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "agency_sales_opportunity_items";`,
    );
  }
}
