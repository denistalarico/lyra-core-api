import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskProjectStageId1782700200000 implements MigrationInterface {
  name = 'AddTaskProjectStageId1782700200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_tasks"
      ADD COLUMN IF NOT EXISTS "project_stage_id" uuid NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_tasks_project_stage_id"
      ON "agency_tasks" ("project_stage_id")
      WHERE "project_stage_id" IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE "agency_tasks" task
      SET "project_stage_id" = task."stage_id"
      FROM "agency_task_stages" stage
      WHERE task."stage_id" = stage."id"
        AND stage."project_id" IS NOT NULL
        AND task."project_id" = stage."project_id"
        AND task."project_stage_id" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "agency_tasks" task
      SET "stage_id" = (
        SELECT workspace_stage."id"
        FROM "agency_task_stages" workspace_stage
        WHERE workspace_stage."tenant_id" = task."tenant_id"
          AND workspace_stage."workspace_id" = task."workspace_id"
          AND workspace_stage."project_id" IS NULL
          AND workspace_stage."is_archived" = false
        ORDER BY workspace_stage."position" ASC, workspace_stage."created_at" ASC
        LIMIT 1
      )
      FROM "agency_task_stages" project_stage
      WHERE task."stage_id" = project_stage."id"
        AND project_stage."project_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_tasks_project_stage_id"`);
    await queryRunner.query(`ALTER TABLE "agency_tasks" DROP COLUMN IF EXISTS "project_stage_id"`);
  }
}
