import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectCardColors1760002033000 implements MigrationInterface {
  name = 'AddProjectCardColors1760002033000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agency_projects
      ADD COLUMN IF NOT EXISTS card_color varchar(32) NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE agency_tasks
      ADD COLUMN IF NOT EXISTS card_color varchar(32) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agency_tasks
      DROP COLUMN IF EXISTS card_color;
    `);

    await queryRunner.query(`
      ALTER TABLE agency_projects
      DROP COLUMN IF EXISTS card_color;
    `);
  }
}
