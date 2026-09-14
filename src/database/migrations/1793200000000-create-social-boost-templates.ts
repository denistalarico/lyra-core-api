import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Local, provider-neutral recipes for the Planner's future governed Boost. */
export class CreateSocialBoostTemplates1793200000000
  implements MigrationInterface
{
  name = 'CreateSocialBoostTemplates1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_boost_templates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "name" varchar(160) NOT NULL,
        "provider" varchar(20) NOT NULL,
        "objective" varchar(40) NOT NULL,
        "budget_type" varchar(20) NOT NULL,
        "budget_amount_minor" bigint NOT NULL,
        "currency" varchar(8) NOT NULL,
        "duration_days" integer NOT NULL,
        "audience_mode" varchar(20) NOT NULL,
        "audience" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "placements" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "special_ad_categories" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "call_to_action" varchar(60),
        "destination_url" text,
        "is_default" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_by_id" uuid,
        "updated_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_boost_templates" PRIMARY KEY ("id"),
        CONSTRAINT "CK_social_boost_templates_provider"
          CHECK ("provider" IN ('meta', 'google', 'tiktok')),
        CONSTRAINT "CK_social_boost_templates_budget_type"
          CHECK ("budget_type" IN ('daily', 'lifetime')),
        CONSTRAINT "CK_social_boost_templates_audience_mode"
          CHECK ("audience_mode" IN ('automatic', 'custom', 'saved')),
        CONSTRAINT "CK_social_boost_templates_budget"
          CHECK ("budget_amount_minor" > 0),
        CONSTRAINT "CK_social_boost_templates_duration"
          CHECK ("duration_days" >= 1 AND "duration_days" <= 90),
        CONSTRAINT "CK_social_boost_templates_audience_object"
          CHECK (jsonb_typeof("audience") = 'object'),
        CONSTRAINT "CK_social_boost_templates_placements_array"
          CHECK (jsonb_typeof("placements") = 'array'),
        CONSTRAINT "CK_social_boost_templates_special_categories_array"
          CHECK (jsonb_typeof("special_ad_categories") = 'array')
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_boost_templates_scope"
        ON "social_boost_templates" (
          "tenant_id", "workspace_id", "agency_client_id", "provider"
        )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_boost_templates_agency_name"
        ON "social_boost_templates" (
          "tenant_id", "workspace_id", lower("name")
        )
        WHERE "agency_client_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_boost_templates_client_name"
        ON "social_boost_templates" (
          "tenant_id", "workspace_id", "agency_client_id", lower("name")
        )
        WHERE "agency_client_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_boost_templates_agency_default"
        ON "social_boost_templates" ("tenant_id", "workspace_id", "provider")
        WHERE "agency_client_id" IS NULL AND "is_default" = true
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_social_boost_templates_client_default"
        ON "social_boost_templates" (
          "tenant_id", "workspace_id", "agency_client_id", "provider"
        )
        WHERE "agency_client_id" IS NOT NULL AND "is_default" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "social_boost_templates"');
  }
}
