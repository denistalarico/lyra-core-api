import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTeamMemberLifecycle1760002057000 implements MigrationInterface {
  name = 'CreateTeamMemberLifecycle1760002057000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "team_member_lifecycle_processes" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "member_id" uuid NOT NULL,
        "process_type" varchar(20) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'in_progress',
        "department_id" uuid NULL,
        "started_at" TIMESTAMPTZ NULL,
        "completed_at" TIMESTAMPTZ NULL,
        "created_by_id" uuid NULL,
        "updated_by_id" uuid NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_team_lifecycle_processes_member"
      ON "team_member_lifecycle_processes" ("tenant_id", "workspace_id", "member_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "team_member_lifecycle_steps" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "process_id" uuid NOT NULL REFERENCES "team_member_lifecycle_processes"("id") ON DELETE CASCADE,
        "member_id" uuid NOT NULL,
        "source_config_option_id" uuid NULL,
        "step_type_id" uuid NULL,
        "title" varchar(180) NOT NULL,
        "description" text NULL,
        "assignee_label" varchar(180) NULL,
        "assignee_member_id" uuid NULL,
        "interval_value" integer NULL,
        "interval_unit" varchar(20) NULL,
        "due_at" TIMESTAMPTZ NULL,
        "status" varchar(20) NOT NULL DEFAULT 'not_started',
        "notes" text NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "created_by_id" uuid NULL,
        "updated_by_id" uuid NULL,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_team_lifecycle_steps_process"
      ON "team_member_lifecycle_steps" ("tenant_id", "workspace_id", "process_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_team_lifecycle_steps_member"
      ON "team_member_lifecycle_steps" ("tenant_id", "workspace_id", "member_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "team_member_lifecycle_steps"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "team_member_lifecycle_processes"`);
  }
}
