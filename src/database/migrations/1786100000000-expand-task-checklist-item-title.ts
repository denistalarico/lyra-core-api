import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandTaskChecklistItemTitle1786100000000 implements MigrationInterface {
  name = 'ExpandTaskChecklistItemTitle1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_task_checklist_items"
      ALTER COLUMN "title" TYPE text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "agency_task_checklist_items"
      SET "title" = LEFT("title", 220)
      WHERE LENGTH("title") > 220
    `);
    await queryRunner.query(`
      ALTER TABLE "agency_task_checklist_items"
      ALTER COLUMN "title" TYPE character varying(220)
    `);
  }
}
