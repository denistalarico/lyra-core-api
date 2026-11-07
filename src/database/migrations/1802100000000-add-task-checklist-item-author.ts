import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Settings > Users (Etapa 2) — a Member may delete only the subtasks they
 * created, so a checklist item now records its author. Existing items have no
 * known author and stay NULL: only a Manager-level user can delete those.
 */
export class AddTaskChecklistItemAuthor1802100000000
  implements MigrationInterface
{
  name = 'AddTaskChecklistItemAuthor1802100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE agency_task_checklist_items ADD COLUMN IF NOT EXISTS created_by_id uuid NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE agency_task_checklist_items DROP COLUMN IF EXISTS created_by_id`,
    );
  }
}
