import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChecklistPersonalStage1782700400000
  implements MigrationInterface
{
  name = 'AddChecklistPersonalStage1782700400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agency_task_checklist_items
      ADD COLUMN IF NOT EXISTS personal_stage_id uuid NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agency_task_checklist_items
      DROP COLUMN IF EXISTS personal_stage_id;
    `);
  }
}
