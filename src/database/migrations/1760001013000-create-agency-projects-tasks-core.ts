import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyProjectsTasksCore1760001013000 implements MigrationInterface {
  name = 'CreateAgencyProjectsTasksCore1760001013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TYPE "agency_project_status_enum" AS ENUM (
        'draft',
        'active',
        'paused',
        'completed',
        'cancelled',
        'archived'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "agency_project_priority_enum" AS ENUM (
        'low',
        'medium',
        'high',
        'urgent'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "agency_task_status_enum" AS ENUM (
        'todo',
        'in_progress',
        'waiting',
        'blocked',
        'done',
        'cancelled',
        'archived'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "agency_task_priority_enum" AS ENUM (
        'low',
        'medium',
        'high',
        'urgent'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "agency_task_visibility_enum" AS ENUM (
        'workspace',
        'private'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_project_stages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "color" character varying(32),
        "position" integer NOT NULL DEFAULT 0,
        "is_default" boolean NOT NULL DEFAULT false,
        "is_archived" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_project_stages" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_task_stages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "color" character varying(32),
        "position" integer NOT NULL DEFAULT 0,
        "is_default" boolean NOT NULL DEFAULT false,
        "is_archived" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_task_stages" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_personal_task_stages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "color" character varying(32),
        "position" integer NOT NULL DEFAULT 0,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_personal_task_stages" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_projects" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "client_id" uuid,
        "stage_id" uuid,
        "owner_id" uuid,
        "name" character varying(180) NOT NULL,
        "description" text,
        "status" "agency_project_status_enum" NOT NULL DEFAULT 'active',
        "priority" "agency_project_priority_enum" NOT NULL DEFAULT 'medium',
        "start_date" TIMESTAMP WITH TIME ZONE,
        "due_date" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "progress" integer NOT NULL DEFAULT 0,
        "archived_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_projects" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_tasks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "project_id" uuid,
        "client_id" uuid,
        "stage_id" uuid,
        "personal_stage_id" uuid,
        "assignee_id" uuid,
        "created_by_id" uuid NOT NULL,
        "title" character varying(180) NOT NULL,
        "description" text,
        "status" "agency_task_status_enum" NOT NULL DEFAULT 'todo',
        "priority" "agency_task_priority_enum" NOT NULL DEFAULT 'medium',
        "visibility" "agency_task_visibility_enum" NOT NULL DEFAULT 'workspace',
        "start_date" TIMESTAMP WITH TIME ZONE,
        "due_date" TIMESTAMP WITH TIME ZONE,
        "completed_at" TIMESTAMP WITH TIME ZONE,
        "estimated_minutes" integer,
        "tracked_minutes" integer NOT NULL DEFAULT 0,
        "is_blocked" boolean NOT NULL DEFAULT false,
        "blocked_reason" text,
        "archived_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_tasks" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_task_checklist_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "task_id" uuid NOT NULL,
        "title" character varying(220) NOT NULL,
        "is_done" boolean NOT NULL DEFAULT false,
        "position" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_task_checklist_items" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_task_comments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "task_id" uuid NOT NULL,
        "author_id" uuid NOT NULL,
        "body" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_task_comments" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "agency_task_time_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "task_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "stopped_at" TIMESTAMP WITH TIME ZONE,
        "duration_minutes" integer,
        "note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agency_task_time_entries" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_agency_project_stages_context" ON "agency_project_stages" ("tenant_id", "workspace_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_project_stages_order" ON "agency_project_stages" ("tenant_id", "workspace_id", "position")`);

    await queryRunner.query(`CREATE INDEX "IDX_agency_task_stages_context" ON "agency_task_stages" ("tenant_id", "workspace_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_task_stages_order" ON "agency_task_stages" ("tenant_id", "workspace_id", "position")`);

    await queryRunner.query(`CREATE INDEX "IDX_agency_personal_task_stages_context" ON "agency_personal_task_stages" ("tenant_id", "workspace_id", "user_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_personal_task_stages_order" ON "agency_personal_task_stages" ("tenant_id", "workspace_id", "user_id", "position")`);

    await queryRunner.query(`CREATE INDEX "IDX_agency_projects_context" ON "agency_projects" ("tenant_id", "workspace_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_projects_stage" ON "agency_projects" ("tenant_id", "workspace_id", "stage_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_projects_client" ON "agency_projects" ("tenant_id", "workspace_id", "client_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_projects_owner" ON "agency_projects" ("tenant_id", "workspace_id", "owner_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_projects_due_date" ON "agency_projects" ("tenant_id", "workspace_id", "due_date")`);

    await queryRunner.query(`CREATE INDEX "IDX_agency_tasks_context" ON "agency_tasks" ("tenant_id", "workspace_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_tasks_project" ON "agency_tasks" ("tenant_id", "workspace_id", "project_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_tasks_client" ON "agency_tasks" ("tenant_id", "workspace_id", "client_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_tasks_stage" ON "agency_tasks" ("tenant_id", "workspace_id", "stage_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_tasks_personal_stage" ON "agency_tasks" ("tenant_id", "workspace_id", "personal_stage_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_tasks_assignee" ON "agency_tasks" ("tenant_id", "workspace_id", "assignee_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_tasks_creator" ON "agency_tasks" ("tenant_id", "workspace_id", "created_by_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_tasks_due_date" ON "agency_tasks" ("tenant_id", "workspace_id", "due_date")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_tasks_visibility" ON "agency_tasks" ("tenant_id", "workspace_id", "visibility")`);

    await queryRunner.query(`CREATE INDEX "IDX_agency_task_checklist_items_task" ON "agency_task_checklist_items" ("tenant_id", "workspace_id", "task_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_task_comments_task" ON "agency_task_comments" ("tenant_id", "workspace_id", "task_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_task_time_entries_task" ON "agency_task_time_entries" ("tenant_id", "workspace_id", "task_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_agency_task_time_entries_user" ON "agency_task_time_entries" ("tenant_id", "workspace_id", "user_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_task_time_entries_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_task_time_entries_task"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_task_comments_task"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_task_checklist_items_task"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_tasks_visibility"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_tasks_due_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_tasks_creator"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_tasks_assignee"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_tasks_personal_stage"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_tasks_stage"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_tasks_client"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_tasks_project"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_tasks_context"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_projects_due_date"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_projects_owner"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_projects_client"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_projects_stage"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_projects_context"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_personal_task_stages_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_personal_task_stages_context"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_task_stages_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_task_stages_context"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_project_stages_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_agency_project_stages_context"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "agency_task_time_entries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_task_comments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_task_checklist_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_tasks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_projects"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_personal_task_stages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_task_stages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_project_stages"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "agency_task_visibility_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "agency_task_priority_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "agency_task_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "agency_project_priority_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "agency_project_status_enum"`);
  }
}
