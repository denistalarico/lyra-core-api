import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAgencyContactSources1782171364936 implements MigrationInterface {
  name = 'AddAgencyContactSources1782171364936';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_contact_sources" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "code" varchar(40) NOT NULL,
        "is_system" boolean NOT NULL DEFAULT false,
        "is_protected" boolean NOT NULL DEFAULT false,
        "position" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_contact_sources_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_contact_sources_workspace_code" UNIQUE ("workspace_id", "code")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_contact_sources_tenant_workspace"
      ON "agency_contact_sources" ("tenant_id", "workspace_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_contact_sources";`);
  }
}
