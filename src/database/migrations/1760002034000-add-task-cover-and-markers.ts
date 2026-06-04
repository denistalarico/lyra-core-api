import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskCoverAndMarkers1760002034000 implements MigrationInterface {
  name = 'AddTaskCoverAndMarkers1760002034000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_tasks"
      ADD COLUMN IF NOT EXISTS "cover_image_url" text,
      ADD COLUMN IF NOT EXISTS "cover_image_asset_key" character varying(255),
      ADD COLUMN IF NOT EXISTS "marker_ids" jsonb NOT NULL DEFAULT '[]'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_tasks"
      DROP COLUMN IF EXISTS "marker_ids",
      DROP COLUMN IF EXISTS "cover_image_asset_key",
      DROP COLUMN IF EXISTS "cover_image_url"
    `);
  }
}
