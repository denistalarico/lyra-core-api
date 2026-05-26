import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyActivitiesCore1760001016000
  implements MigrationInterface
{
  name = 'CreateAgencyActivitiesCore1760001016000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "agency_activities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "type" character varying(40) NOT NULL,
        "subtype" character varying(80),
        "status" character varying(40) NOT NULL DEFAULT 'todo',
        "priority" character varying(40) NOT NULL DEFAULT 'medium',
        "summary" character varying(180) NOT NULL,
        "note" text,
        "completion_feedback" text,
        "due_at" TIMESTAMP WITH TIME ZONE,
        "start_at" TIMESTAMP WITH TIME ZONE,
        "end_at" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "cancelled_at" TIMESTAMP WITH TIME ZONE,
        "archived_at" TIMESTAMP WITH TIME ZONE,
        "assigned_to_id" uuid,
        "created_by_id" uuid,
        "completed_by_id" uuid,
        "cancelled_by_id" uuid,
        "source_module" character varying(80),
        "visibility" character varying(40) NOT NULL DEFAULT 'workspace',
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_activities" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_activity_links" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "activity_id" uuid NOT NULL,
        "entity_type" character varying(80) NOT NULL,
        "entity_id" uuid NOT NULL,
        "relation_type" character varying(80) NOT NULL DEFAULT 'related_to',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_activity_links" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_activities_tenant_workspace"
      ON "agency_activities" ("tenant_id", "workspace_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_activities_status"
      ON "agency_activities" ("tenant_id", "workspace_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_activities_type"
      ON "agency_activities" ("tenant_id", "workspace_id", "type")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_activities_due_at"
      ON "agency_activities" ("tenant_id", "workspace_id", "due_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_activities_assigned_to"
      ON "agency_activities" ("tenant_id", "workspace_id", "assigned_to_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_activities_source_module"
      ON "agency_activities" ("tenant_id", "workspace_id", "source_module")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_activity_links_activity"
      ON "agency_activity_links" ("tenant_id", "workspace_id", "activity_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_agency_activity_links_entity"
      ON "agency_activity_links" ("tenant_id", "workspace_id", "entity_type", "entity_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_agency_activity_links_unique_relation"
      ON "agency_activity_links" (
        "tenant_id",
        "workspace_id",
        "activity_id",
        "entity_type",
        "entity_id",
        "relation_type"
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_activity_links"
      ADD CONSTRAINT "FK_agency_activity_links_activity"
      FOREIGN KEY ("activity_id")
      REFERENCES "agency_activities"("id")
      ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_activity_links"
      DROP CONSTRAINT IF EXISTS "FK_agency_activity_links_activity"
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_agency_activity_links_unique_relation"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_activity_links_entity"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_activity_links_activity"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_activities_source_module"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_activities_assigned_to"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_activities_due_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_activities_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_activities_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_activities_tenant_workspace"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_activity_links"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_activities"`);
  }
}
