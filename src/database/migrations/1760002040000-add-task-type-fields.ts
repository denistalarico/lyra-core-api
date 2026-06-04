import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskTypeFields1760002040000 implements MigrationInterface {
  name = 'AddTaskTypeFields1760002040000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_tasks"
      ADD COLUMN IF NOT EXISTS "task_type_id" character varying(120)
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_task_checklist_items"
      ADD COLUMN IF NOT EXISTS "task_type_id" character varying(120)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_task_checklist_items"
      DROP COLUMN IF EXISTS "task_type_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_tasks"
      DROP COLUMN IF EXISTS "task_type_id"
    `);
  }
}
