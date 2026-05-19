import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencySalesActivities1760001004000
  implements MigrationInterface
{
  name = 'CreateAgencySalesActivities1760001004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_sales_activities" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "opportunity_id" uuid NOT NULL,
        "contact_id" uuid,
        "assigned_user_id" uuid,
        "type" varchar(30) NOT NULL DEFAULT 'follow_up',
        "status" varchar(30) NOT NULL DEFAULT 'pending',
        "title" varchar(160) NOT NULL,
        "description" text,
        "due_at" timestamptz,
        "completed_at" timestamptz,
        "completed_by_user_id" uuid,
        "outcome" varchar(160),
        "position" int NOT NULL DEFAULT 0,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_sales_activities_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_agency_sales_activities_opportunity"
          FOREIGN KEY ("opportunity_id")
          REFERENCES "agency_sales_opportunities" ("id")
          ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_sales_activities_opportunity"
      ON "agency_sales_activities" (opportunity_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_sales_activities_tenant_workspace"
      ON "agency_sales_activities" (tenant_id, workspace_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_sales_activities_due_at"
      ON "agency_sales_activities" (tenant_id, workspace_id, due_at);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_sales_activities_assigned_user"
      ON "agency_sales_activities" (assigned_user_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_sales_activities_assigned_user";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_sales_activities_due_at";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_sales_activities_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_sales_activities_opportunity";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_sales_activities";`);
  }
}
