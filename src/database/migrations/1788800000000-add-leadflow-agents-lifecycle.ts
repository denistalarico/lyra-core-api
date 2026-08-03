import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLeadflowAgentsLifecycle1788800000000
  implements MigrationInterface
{
  name = 'AddLeadflowAgentsLifecycle1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leadflow_agents"
      ADD COLUMN "archived_at" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN "deleted_at" TIMESTAMP WITH TIME ZONE,
      ADD COLUMN "deleted_by_id" uuid
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_agents_deleted_at"
      ON "leadflow_agents" ("deleted_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_lf_agents_deleted_at"`);
    await queryRunner.query(`
      ALTER TABLE "leadflow_agents"
      DROP COLUMN IF EXISTS "deleted_by_id",
      DROP COLUMN IF EXISTS "deleted_at",
      DROP COLUMN IF EXISTS "archived_at"
    `);
  }
}
