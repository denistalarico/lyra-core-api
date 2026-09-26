import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives each persisted Analytics dashboard an optional operator-authored
 * description. It remains scoped by the dashboard's existing company-aware
 * root; this migration adds no independently addressable record.
 */
export class AddSocialDashboardDescription1796900000000
  implements MigrationInterface
{
  name = 'AddSocialDashboardDescription1796900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_analytics_dashboards"
         ADD COLUMN IF NOT EXISTS "description" varchar(500)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_analytics_dashboards"
         DROP COLUMN IF EXISTS "description"`,
    );
  }
}
