import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * YT3-BE (D-I3) — `watch_time_seconds` on the organic account daily table.
 *
 * YouTube reports a channel's watch time per day and no existing column holds
 * it (the post table already has one). Additive and nullable: no row is
 * touched. Non-additive ratios such as the average view duration are never
 * stored; they are derived at read time from this and the views.
 */
export class SocialOrganicAccountWatchTime1804300000000 implements MigrationInterface {
  name = 'SocialOrganicAccountWatchTime1804300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_organic_account_metrics_daily"
         ADD COLUMN IF NOT EXISTS "watch_time_seconds" bigint NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_organic_account_metrics_daily"
         DROP CONSTRAINT IF EXISTS "CK_social_organic_account_metrics_daily_watch_time"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_organic_account_metrics_daily"
         ADD CONSTRAINT "CK_social_organic_account_metrics_daily_watch_time"
         CHECK ("watch_time_seconds" >= 0)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_organic_account_metrics_daily"
         DROP CONSTRAINT IF EXISTS "CK_social_organic_account_metrics_daily_watch_time"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_organic_account_metrics_daily"
         DROP COLUMN IF EXISTS "watch_time_seconds"`,
    );
  }
}
