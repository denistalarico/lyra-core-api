import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectStageTemplates1782700000000
  implements MigrationInterface
{
  name = 'AddProjectStageTemplates1782700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agency_project_settings
      ADD COLUMN IF NOT EXISTS stage_templates jsonb NOT NULL DEFAULT '[]'::jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agency_project_settings
      DROP COLUMN IF EXISTS stage_templates;
    `);
  }
}
