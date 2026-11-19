import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GL1 (2026-11-19): Google Ads lead-form webhook feeds the Forms addon.
 * Plan: docs/sprints/social/social-google-ads-leads-analytics-plan-2026-11-18.md (§4.2 D-L1..D-L5, §5.5).
 *
 * - `forms.google_ads_leads`: channel settings and counters (no secret).
 * - `forms.google_ads_key_hash`: sha256 of the webhook key, kept apart from the
 *   jsonb so no read of the form can ever carry it (the entity maps it `select: false`).
 * - `form_submissions.external_lead_id`: provider lead id, unique per form + source.
 * - CHECK `source` gets both ad sources at once so ML1 does not touch it again.
 */
export class AddFormsGoogleAdsLeads1804900000000 implements MigrationInterface {
  name = 'AddFormsGoogleAdsLeads1804900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "forms"
        ADD COLUMN IF NOT EXISTS "google_ads_leads" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "google_ads_key_hash" varchar(64) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "form_submissions"
        ADD COLUMN IF NOT EXISTS "external_lead_id" varchar(200) NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_form_submissions_external_lead"
        ON "form_submissions" ("form_id", "source", "external_lead_id")
        WHERE "external_lead_id" IS NOT NULL
    `);
    await queryRunner.query(
      `ALTER TABLE "form_submissions" DROP CONSTRAINT IF EXISTS "chk_form_submissions_source"`,
    );
    await queryRunner.query(`
      ALTER TABLE "form_submissions"
        ADD CONSTRAINT "chk_form_submissions_source"
        CHECK ("source" IN ('page', 'embed', 'script', 'email', 'google_ads', 'meta_lead_ads'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // NOT VALID: rows already stored with an ad source stay; only new rows are checked.
    await queryRunner.query(
      `ALTER TABLE "form_submissions" DROP CONSTRAINT IF EXISTS "chk_form_submissions_source"`,
    );
    await queryRunner.query(`
      ALTER TABLE "form_submissions"
        ADD CONSTRAINT "chk_form_submissions_source"
        CHECK ("source" IN ('page', 'embed', 'script', 'email')) NOT VALID
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_form_submissions_external_lead"`,
    );
    await queryRunner.query(
      `ALTER TABLE "form_submissions" DROP COLUMN IF EXISTS "external_lead_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "forms"
        DROP COLUMN IF EXISTS "google_ads_key_hash",
        DROP COLUMN IF EXISTS "google_ads_leads"
    `);
  }
}
