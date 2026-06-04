import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectIdToTaskStages1760002036000 implements MigrationInterface {
  name = 'AddProjectIdToTaskStages1760002036000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_task_stages"
      ADD COLUMN IF NOT EXISTS "project_id" uuid NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_task_stages_project_id"
      ON "agency_task_stages" ("project_id")
      WHERE "project_id" IS NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "agency_project_events"
      ALTER COLUMN "kind" TYPE character varying(32)
    `);
    await queryRunner.query(`
      ALTER TABLE "agency_project_events"
      ADD COLUMN IF NOT EXISTS "meta" jsonb NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_agency_task_stages_project_id"`);
    await queryRunner.query(`ALTER TABLE "agency_task_stages" DROP COLUMN IF EXISTS "project_id"`);
    await queryRunner.query(`ALTER TABLE "agency_project_events" DROP COLUMN IF EXISTS "meta"`);
  }
}
