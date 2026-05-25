import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyCalendarSettings1760001012000
  implements MigrationInterface
{
  name = 'CreateAgencyCalendarSettings1760001012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "calendar_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NULL,
        "user_id" uuid NOT NULL,
        "default_view" character varying(24) NOT NULL DEFAULT 'week',
        "default_event_duration_minutes" integer NOT NULL DEFAULT 60,
        "week_starts_on" integer NOT NULL DEFAULT 1,
        "workday_start_time" time NOT NULL DEFAULT '08:00:00',
        "workday_end_time" time NOT NULL DEFAULT '18:00:00',
        "quiet_hours_enabled" boolean NOT NULL DEFAULT false,
        "quiet_hours_start_time" time NOT NULL DEFAULT '22:00:00',
        "quiet_hours_end_time" time NOT NULL DEFAULT '07:00:00',
        "notifications_enabled" boolean NOT NULL DEFAULT true,
        "email_notifications_enabled" boolean NOT NULL DEFAULT true,
        "in_app_notifications_enabled" boolean NOT NULL DEFAULT true,
        "default_reminder_minutes" integer NOT NULL DEFAULT 60,
        "calendar_sharing_enabled" boolean NOT NULL DEFAULT true,
        "default_sharing_permission" character varying(24) NOT NULL DEFAULT 'view',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_calendar_settings_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_calendar_settings_context"
      ON "calendar_settings" ("tenant_id", "workspace_id", "user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "calendar_settings"`);
  }
}
