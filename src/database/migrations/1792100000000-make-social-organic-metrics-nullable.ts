import type { MigrationInterface, QueryRunner } from 'typeorm';

const POST_COUNTERS = [
  'impressions',
  'reach',
  'likes',
  'comments',
  'shares',
  'saves',
  'video_views',
  'watch_time_seconds',
  'link_clicks',
  'profile_visits',
] as const;

const ACCOUNT_COUNTERS = [
  'followers_count',
  'followers_gained',
  'followers_lost',
  'impressions',
  'reach',
  'profile_views',
] as const;

/**
 * Meta omits unavailable insight metrics instead of returning zero. Nullable
 * counters preserve that distinction while keeping every stored counter a
 * bigint. The A2 writer later treats NULL as "no new evidence" on conflict.
 */
export class MakeSocialOrganicMetricsNullable1792100000000 implements MigrationInterface {
  name = 'MakeSocialOrganicMetricsNullable1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.makeNullable(
      queryRunner,
      'social_organic_post_metrics_daily',
      POST_COUNTERS,
    );
    await this.makeNullable(
      queryRunner,
      'social_organic_account_metrics_daily',
      ACCOUNT_COUNTERS,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await this.restoreRequired(
      queryRunner,
      'social_organic_account_metrics_daily',
      ACCOUNT_COUNTERS,
    );
    await this.restoreRequired(
      queryRunner,
      'social_organic_post_metrics_daily',
      POST_COUNTERS,
    );
  }

  private async makeNullable(
    queryRunner: QueryRunner,
    table: string,
    columns: readonly string[],
  ): Promise<void> {
    for (const column of columns) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP DEFAULT`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP NOT NULL`,
      );
    }
  }

  private async restoreRequired(
    queryRunner: QueryRunner,
    table: string,
    columns: readonly string[],
  ): Promise<void> {
    for (const column of columns) {
      await queryRunner.query(
        `UPDATE "${table}" SET "${column}" = 0 WHERE "${column}" IS NULL`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET DEFAULT 0`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" SET NOT NULL`,
      );
    }
  }
}
