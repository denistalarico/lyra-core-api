import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Persists original Social Analytics PDFs and immutable emission metadata. */
export class StoreSocialAnalyticsReportFiles1797200000000 implements MigrationInterface {
  name = 'StoreSocialAnalyticsReportFiles1797200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_analytics_reports"
        ADD COLUMN IF NOT EXISTS "storage_key" text,
        ADD COLUMN IF NOT EXISTS "file_name" varchar(180),
        ADD COLUMN IF NOT EXISTS "issued_by_name" varchar(160),
        ADD COLUMN IF NOT EXISTS "issued_timezone" varchar(80);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_analytics_reports"
        DROP COLUMN IF EXISTS "issued_timezone",
        DROP COLUMN IF EXISTS "issued_by_name",
        DROP COLUMN IF EXISTS "file_name",
        DROP COLUMN IF EXISTS "storage_key";
    `);
  }
}
