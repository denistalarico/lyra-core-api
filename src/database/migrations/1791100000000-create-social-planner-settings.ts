import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Strategic settings for Social Planner.
 *
 * One row per operational Social context. Agency and managed-client
 * uniqueness are split because PostgreSQL treats NULL values as distinct.
 *
 * Business defaults remain in the application layer so recommendations can
 * evolve without schema migrations.
 */
export class CreateSocialPlannerSettings1791100000000
  implements MigrationInterface
{
  name = 'CreateSocialPlannerSettings1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_planner_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),

        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        "monthly_content_volume" smallint NOT NULL DEFAULT 8,

        "funnel_distribution" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "content_types" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "objectives" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "creative_formats" jsonb NOT NULL DEFAULT '[]'::jsonb,

        "cta_defaults" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "hashtag_defaults" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "first_comment_defaults" jsonb NOT NULL DEFAULT '{}'::jsonb,

        "hook_library" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "milestones" jsonb NOT NULL DEFAULT '[]'::jsonb,

        "created_by_id" uuid,
        "updated_by_id" uuid,

        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_planner_settings"
          PRIMARY KEY ("id"),

        CONSTRAINT "CK_social_planner_settings_monthly_volume"
          CHECK (
            "monthly_content_volume" >= 1
            AND "monthly_content_volume" <= 365
          ),

        CONSTRAINT "CK_social_planner_settings_funnel_object"
          CHECK (jsonb_typeof("funnel_distribution") = 'object'),

        CONSTRAINT "CK_social_planner_settings_content_types_array"
          CHECK (jsonb_typeof("content_types") = 'array'),

        CONSTRAINT "CK_social_planner_settings_objectives_array"
          CHECK (jsonb_typeof("objectives") = 'array'),

        CONSTRAINT "CK_social_planner_settings_creative_formats_array"
          CHECK (jsonb_typeof("creative_formats") = 'array'),

        CONSTRAINT "CK_social_planner_settings_cta_object"
          CHECK (jsonb_typeof("cta_defaults") = 'object'),

        CONSTRAINT "CK_social_planner_settings_hashtag_object"
          CHECK (jsonb_typeof("hashtag_defaults") = 'object'),

        CONSTRAINT "CK_social_planner_settings_first_comment_object"
          CHECK (jsonb_typeof("first_comment_defaults") = 'object'),

        CONSTRAINT "CK_social_planner_settings_hooks_array"
          CHECK (jsonb_typeof("hook_library") = 'array'),

        CONSTRAINT "CK_social_planner_settings_milestones_array"
          CHECK (jsonb_typeof("milestones") = 'array')
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_planner_settings_agency_scope"
        ON "social_planner_settings" (
          "tenant_id",
          "workspace_id"
        )
        WHERE "agency_client_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_planner_settings_client_scope"
        ON "social_planner_settings" (
          "tenant_id",
          "workspace_id",
          "agency_client_id"
        )
        WHERE "agency_client_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS
        "IDX_social_planner_settings_scope"
        ON "social_planner_settings" (
          "tenant_id",
          "workspace_id",
          "agency_client_id"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_planner_settings_scope"',
    );

    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_planner_settings_client_scope"',
    );

    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_planner_settings_agency_scope"',
    );

    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_planner_settings"',
    );
  }
}
