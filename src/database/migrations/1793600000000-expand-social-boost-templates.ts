import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds the C6 campaign goal and richer audience recipe without losing C1 data. */
export class ExpandSocialBoostTemplates1793600000000 implements MigrationInterface {
  name = 'ExpandSocialBoostTemplates1793600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
        ADD COLUMN IF NOT EXISTS "performance_goal" varchar(60),
        ADD COLUMN IF NOT EXISTS "conversion_location" varchar(40),
        ADD COLUMN IF NOT EXISTS "conversion_event" varchar(60)
    `);

    await queryRunner.query(`
      UPDATE "social_boost_templates"
      SET
        "audience" = jsonb_build_object(
          'countries', '[]'::jsonb,
          'regions', '[]'::jsonb,
          'cities', '[]'::jsonb,
          'postalCodes', '[]'::jsonb,
          'ageMin', NULL,
          'ageMax', NULL,
          'genders', '[]'::jsonb,
          'languages', '[]'::jsonb,
          'interests', '[]'::jsonb,
          'savedAudienceExternalId', NULL
        ) || "audience",
        "performance_goal" = CASE "objective"
          WHEN 'awareness' THEN 'reach'
          WHEN 'traffic' THEN 'landing_page_views'
          WHEN 'leads' THEN 'instant_form_leads'
          WHEN 'sales' THEN 'conversions'
          ELSE 'post_engagement'
        END,
        "conversion_location" = CASE "objective"
          WHEN 'traffic' THEN 'website'
          WHEN 'leads' THEN 'instant_forms'
          WHEN 'sales' THEN 'website'
          ELSE 'on_ad'
        END,
        "conversion_event" = CASE "objective"
          WHEN 'sales' THEN 'PURCHASE'
          ELSE "conversion_event"
        END
      WHERE
        "performance_goal" IS NULL OR
        "conversion_location" IS NULL OR
        NOT ("audience" ?& ARRAY['regions', 'cities', 'postalCodes', 'languages'])
    `);

    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
        ALTER COLUMN "performance_goal" SET NOT NULL,
        ALTER COLUMN "conversion_location" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
        ADD CONSTRAINT "CK_social_boost_templates_objective"
          CHECK ("objective" IN (
            'awareness', 'traffic', 'engagement', 'leads', 'sales', 'followers'
          )),
        ADD CONSTRAINT "CK_social_boost_templates_performance_goal"
          CHECK ("performance_goal" IN (
            'reach', 'impressions', 'link_clicks', 'landing_page_views',
            'post_engagement', 'thruplay', 'two_second_video_views',
            'messaging_conversations_started', 'instant_form_leads',
            'website_leads', 'conversions', 'value', 'profile_visits',
            'page_likes'
          )),
        ADD CONSTRAINT "CK_social_boost_templates_conversion_location"
          CHECK ("conversion_location" IN (
            'on_ad', 'website', 'messaging_apps', 'instant_forms',
            'instagram_profile', 'facebook_page', 'shop'
          ))
    `);

    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
        DROP CONSTRAINT IF EXISTS "CK_social_boost_templates_audience_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
        ADD CONSTRAINT "CK_social_boost_templates_audience_mode"
        CHECK (
          "audience_mode" IN (
            'automatic', 'custom', 'saved', 'followers', 'engagers'
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
        DROP CONSTRAINT IF EXISTS "CK_social_boost_templates_conversion_location",
        DROP CONSTRAINT IF EXISTS "CK_social_boost_templates_performance_goal",
        DROP CONSTRAINT IF EXISTS "CK_social_boost_templates_objective"
    `);
    await queryRunner.query(`
      UPDATE "social_boost_templates"
      SET "audience_mode" = 'automatic'
      WHERE "audience_mode" IN ('followers', 'engagers')
    `);
    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
        DROP CONSTRAINT IF EXISTS "CK_social_boost_templates_audience_mode"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
        ADD CONSTRAINT "CK_social_boost_templates_audience_mode"
        CHECK ("audience_mode" IN ('automatic', 'custom', 'saved'))
    `);
    await queryRunner.query(`
      ALTER TABLE "social_boost_templates"
        DROP COLUMN IF EXISTS "conversion_event",
        DROP COLUMN IF EXISTS "conversion_location",
        DROP COLUMN IF EXISTS "performance_goal"
    `);
  }
}
