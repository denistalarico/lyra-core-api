import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hourly observations of Google Trends "Trending now", so the Social Overview
 * can rank the week and the month. Public data, not tenant-scoped.
 */
export class CreateSocialTrendSnapshots1803600000000 implements MigrationInterface {
  name = 'CreateSocialTrendSnapshots1803600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_trend_snapshots" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "country" varchar(2) NOT NULL,
        "term" varchar(200) NOT NULL,
        "normalized_term" varchar(200) NOT NULL,
        "traffic" integer NULL,
        "traffic_label" varchar(40) NULL,
        "news_url" text NULL,
        "news_title" varchar(400) NULL,
        "observed_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_trend_snapshots_window" ON "social_trend_snapshots" ("country", "observed_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "social_trend_snapshots"`);
  }
}
