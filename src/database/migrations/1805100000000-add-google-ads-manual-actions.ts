import type { MigrationInterface, QueryRunner } from 'typeorm';

const LEGACY_TYPES = `'set_status', 'set_budget', 'set_end_time', 'delete'`;
const GOOGLE_KEYWORD_TYPES = `'negative_keyword', 'keyword', 'search_theme'`;

/**
 * GA-WRITE (2026-11-20): governed manual writes on Google Ads.
 * Plan: docs/sprints/social/social-google-ads-leads-analytics-plan-2026-11-18.md (§4.2 D-G5).
 *
 * - `social_ad_action_policies.allow_keywords` (default false): the per-account
 *   opt-in for negative keywords, keywords and PMax search themes. Existing
 *   policies keep every current permission and gain no new one.
 * - `social_ad_governed_actions.action_type` admits the three keyword actions.
 *   Status and budget on Google reuse `set_status` / `set_budget`.
 */
export class AddGoogleAdsManualActions1805100000000 implements MigrationInterface {
  name = 'AddGoogleAdsManualActions1805100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_ad_action_policies"
        ADD COLUMN IF NOT EXISTS "allow_keywords" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      ALTER TABLE "social_ad_governed_actions"
        DROP CONSTRAINT IF EXISTS "CK_social_ad_governed_action_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_ad_governed_actions"
        ADD CONSTRAINT "CK_social_ad_governed_action_type"
        CHECK ("action_type" IN (${LEGACY_TYPES}, ${GOOGLE_KEYWORD_TYPES}))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The narrower CHECK cannot hold rows of the new types.
    await queryRunner.query(`
      DELETE FROM "social_ad_governed_actions"
        WHERE "action_type" IN (${GOOGLE_KEYWORD_TYPES})
    `);
    await queryRunner.query(`
      ALTER TABLE "social_ad_governed_actions"
        DROP CONSTRAINT IF EXISTS "CK_social_ad_governed_action_type"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_ad_governed_actions"
        ADD CONSTRAINT "CK_social_ad_governed_action_type"
        CHECK ("action_type" IN (${LEGACY_TYPES}))
    `);
    await queryRunner.query(`
      ALTER TABLE "social_ad_action_policies"
        DROP COLUMN IF EXISTS "allow_keywords"
    `);
  }
}
