import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChecklistItemAssignee1782700100000
  implements MigrationInterface
{
  name = 'AddChecklistItemAssignee1782700100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agency_task_checklist_items
      ADD COLUMN IF NOT EXISTS assignee_id uuid NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agency_task_checklist_items
      DROP COLUMN IF EXISTS assignee_id;
    `);
  }
}
