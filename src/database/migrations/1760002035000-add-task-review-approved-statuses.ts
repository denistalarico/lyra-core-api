import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskReviewApprovedStatuses1760002035000 implements MigrationInterface {
  name = 'AddTaskReviewApprovedStatuses1760002035000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "agency_task_status_enum"
      ADD VALUE IF NOT EXISTS 'in_review'
    `);
    await queryRunner.query(`
      ALTER TYPE "agency_task_status_enum"
      ADD VALUE IF NOT EXISTS 'approved'
    `);
    await queryRunner.query(`
      ALTER TABLE "agency_task_checklist_items"
      ADD COLUMN IF NOT EXISTS "status" character varying(32) NOT NULL DEFAULT 'in_progress'
    `);
    await queryRunner.query(`
      UPDATE "agency_task_checklist_items"
      SET "status" = CASE WHEN "is_done" THEN 'done' ELSE 'in_progress' END
      WHERE "status" IS NULL OR "status" = 'in_progress'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_task_checklist_items"
      DROP COLUMN IF EXISTS "status"
    `);
  }
}
