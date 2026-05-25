import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyCalendarCore1760001011000
  implements MigrationInterface
{
  name = 'CreateAgencyCalendarCore1760001011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "calendar_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NULL,
        "title" character varying(180) NOT NULL,
        "description" text NULL,
        "event_type" character varying(48) NOT NULL DEFAULT 'internal_meeting',
        "status" character varying(32) NOT NULL DEFAULT 'scheduled',
        "visibility" character varying(32) NOT NULL DEFAULT 'workspace',
        "starts_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "ends_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "all_day" boolean NOT NULL DEFAULT false,
        "owner_user_id" uuid NULL,
        "created_by_user_id" uuid NULL,
        "client_id" uuid NULL,
        "project_id" uuid NULL,
        "task_id" uuid NULL,
        "sales_opportunity_id" uuid NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE NULL,
        CONSTRAINT "PK_calendar_events_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_calendar_events_tenant_workspace"
      ON "calendar_events" ("tenant_id", "workspace_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_calendar_events_tenant_workspace_starts"
      ON "calendar_events" ("tenant_id", "workspace_id", "starts_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_calendar_events_owner"
      ON "calendar_events" ("tenant_id", "workspace_id", "owner_user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "calendar_routine_blocks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NULL,
        "user_id" uuid NOT NULL,
        "title" character varying(140) NOT NULL,
        "description" text NULL,
        "weekday" integer NOT NULL,
        "start_time" time NOT NULL,
        "end_time" time NOT NULL,
        "visibility" character varying(32) NOT NULL DEFAULT 'private',
        "show_as_busy" boolean NOT NULL DEFAULT true,
        "color_key" character varying(32) NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE NULL,
        CONSTRAINT "PK_calendar_routine_blocks_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_calendar_routine_tenant_workspace"
      ON "calendar_routine_blocks" ("tenant_id", "workspace_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_calendar_routine_user"
      ON "calendar_routine_blocks" ("tenant_id", "workspace_id", "user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_calendar_routine_user_weekday"
      ON "calendar_routine_blocks" ("tenant_id", "workspace_id", "user_id", "weekday")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "calendar_routine_blocks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "calendar_events"`);
  }
}
