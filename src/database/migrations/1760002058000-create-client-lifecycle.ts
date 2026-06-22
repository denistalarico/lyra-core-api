import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClientLifecycle1760002058000 implements MigrationInterface {
  name = 'CreateClientLifecycle1760002058000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "client_lifecycle_processes" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "client_id" uuid NOT NULL,
        "process_type" varchar(20) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'in_progress',
        "template_config_option_id" uuid NULL,
        "lost_reason_id" uuid NULL,
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
      CREATE INDEX IF NOT EXISTS "idx_client_lifecycle_processes_client"
      ON "client_lifecycle_processes" ("tenant_id", "workspace_id", "client_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "client_lifecycle_steps" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "process_id" uuid NOT NULL REFERENCES "client_lifecycle_processes"("id") ON DELETE CASCADE,
        "client_id" uuid NOT NULL,
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
      CREATE INDEX IF NOT EXISTS "idx_client_lifecycle_steps_process"
      ON "client_lifecycle_steps" ("tenant_id", "workspace_id", "process_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_client_lifecycle_steps_client"
      ON "client_lifecycle_steps" ("tenant_id", "workspace_id", "client_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "client_lifecycle_steps"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "client_lifecycle_processes"`);
  }
}
