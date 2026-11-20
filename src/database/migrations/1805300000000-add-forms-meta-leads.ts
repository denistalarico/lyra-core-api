import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ML1 (2026-11-20): Meta Lead Ads feed the Forms addon.
 * Plan: docs/sprints/social/social-google-ads-leads-analytics-plan-2026-11-18.md (§4.2 D-L7, §5.5).
 *
 * - `forms.meta_leads`: linked Pages/Meta forms, subscription state and counters.
 *
 * The `meta_lead_ads` submission source, `external_lead_id` and its unique
 * index already came with GL1 (`1804900000000`), so this only adds the column.
 */
export class AddFormsMetaLeads1805300000000 implements MigrationInterface {
  name = 'AddFormsMetaLeads1805300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "forms"
        ADD COLUMN IF NOT EXISTS "meta_leads" jsonb NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "forms" DROP COLUMN IF EXISTS "meta_leads"`,
    );
  }
}
