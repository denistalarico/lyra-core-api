import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyProjectEvents1760001015000 implements MigrationInterface {
  name = 'CreateAgencyProjectEvents1760001015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agency_project_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "project_id" uuid NOT NULL,
        "author_id" uuid NOT NULL,
        "kind" character varying(24) NOT NULL,
        "body" text NOT NULL,
        "due_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_project_events" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_project_events_project"
      ON "agency_project_events" ("tenant_id", "workspace_id", "project_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_project_events_kind"
      ON "agency_project_events" ("tenant_id", "workspace_id", "project_id", "kind")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_project_events_kind"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_project_events_project"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_project_events"`);
  }
}
