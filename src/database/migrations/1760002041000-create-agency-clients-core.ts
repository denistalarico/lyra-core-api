import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyClientsCore1760002041000
  implements MigrationInterface
{
  name = 'CreateAgencyClientsCore1760002041000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE "agency_clients" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "contact_id" uuid,
        "display_name" character varying(180) NOT NULL,
        "legal_name" character varying(180),
        "status" character varying(40) NOT NULL DEFAULT 'active',
        "lifecycle_stage" character varying(40) NOT NULL DEFAULT 'active',
        "health_status" character varying(40) NOT NULL DEFAULT 'unknown',
        "segment" character varying(120),
        "account_owner_id" uuid,
        "managed_tenant_id" uuid,
        "start_date" date,
        "end_date" date,
        "notes" text,
        "metadata" jsonb,
        "archived_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_clients" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_agency_clients_tenant_workspace"
      ON "agency_clients" ("tenant_id", "workspace_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_agency_clients_contact"
      ON "agency_clients" ("contact_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_agency_clients_status"
      ON "agency_clients" ("tenant_id", "workspace_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_agency_clients_owner"
      ON "agency_clients" ("account_owner_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_agency_clients_managed_tenant"
      ON "agency_clients" ("managed_tenant_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_agency_clients_workspace_contact"
      ON "agency_clients" ("workspace_id", "contact_id")
      WHERE "contact_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_agency_clients_workspace_contact"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_clients_managed_tenant"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_clients_owner"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_clients_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_clients_contact"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_clients_tenant_workspace"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_clients"`);
  }
}
