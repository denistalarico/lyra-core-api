import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubtaskDetailAndTime1782700300000
  implements MigrationInterface
{
  name = 'AddSubtaskDetailAndTime1782700300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agency_task_checklist_items
      ADD COLUMN IF NOT EXISTS description text NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE agency_task_time_entries
      ADD COLUMN IF NOT EXISTS checklist_item_id uuid NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_time_entries_checklist_item
      ON agency_task_time_entries (checklist_item_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_agency_time_entries_checklist_item;
    `);

    await queryRunner.query(`
      ALTER TABLE agency_task_time_entries
      DROP COLUMN IF EXISTS checklist_item_id;
    `);

    await queryRunner.query(`
      ALTER TABLE agency_task_checklist_items
      DROP COLUMN IF EXISTS description;
    `);
  }
}
