import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Social Planner core foundation.
 *
 * Additive only: creates the canonical planning hierarchy without touching
 * Social Integrations, Agency Projects, Finance, LeadFlow or existing Brand
 * Kit data.
 *
 * Scope follows the existing Lyra Social convention:
 * tenant_id + workspace_id + nullable agency_client_id.
 *
 * NULL agency_client_id = the agency's own Social context.
 * Non-null agency_client_id = a managed client operated by the agency.
 */
export class CreateSocialPlannerCore1790900000000
  implements MigrationInterface
{
  name = 'CreateSocialPlannerCore1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_plans" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        "title" varchar(240) NOT NULL,
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,

        "status" varchar(32) NOT NULL DEFAULT 'draft',
        "primary_objective" varchar(120),
        "strategy_mode" varchar(40),
        "summary" text,

        "created_by_id" uuid,
        "updated_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_plans"
          PRIMARY KEY ("id"),

        CONSTRAINT "CK_social_plans_period"
          CHECK ("period_end" >= "period_start"),

        CONSTRAINT "CK_social_plans_status"
          CHECK (
            "status" IN (
              'draft',
              'in_review',
              'client_review',
              'approved',
              'active',
              'completed',
              'archived'
            )
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_plans_scope"
        ON "social_plans" (
          "tenant_id",
          "workspace_id",
          "agency_client_id"
        )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_plans_period"
        ON "social_plans" (
          "tenant_id",
          "workspace_id",
          "agency_client_id",
          "period_start",
          "period_end"
        )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_content_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        "plan_id" uuid NOT NULL,

        "title" varchar(240) NOT NULL,
        "theme" text,
        "brief" text,
        "key_message" text,

        "funnel_stage" varchar(80),
        "content_type" varchar(80),
        "objective" varchar(120),
        "creative_format" varchar(80),

        "planning_status" varchar(40) NOT NULL DEFAULT 'planned',
        "planned_date" date,
        "sort_order" integer NOT NULL DEFAULT 0,

        "created_by_id" uuid,
        "updated_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_content_items"
          PRIMARY KEY ("id"),

        CONSTRAINT "FK_social_content_items_plan"
          FOREIGN KEY ("plan_id")
          REFERENCES "social_plans" ("id")
          ON DELETE CASCADE,

        CONSTRAINT "CK_social_content_items_status"
          CHECK (
            "planning_status" IN (
              'idea',
              'planned',
              'copy_in_progress',
              'copy_ready',
              'creative_in_progress',
              'creative_ready',
              'ready'
            )
          ),

        CONSTRAINT "CK_social_content_items_sort_order"
          CHECK ("sort_order" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_content_items_scope"
        ON "social_content_items" (
          "tenant_id",
          "workspace_id",
          "agency_client_id"
        )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_content_items_plan"
        ON "social_content_items" ("plan_id", "sort_order")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_content_destinations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        "content_item_id" uuid NOT NULL,

        "channel" varchar(40) NOT NULL,
        "placement" varchar(40) NOT NULL,
        "planned_at" timestamptz,

        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_content_destinations"
          PRIMARY KEY ("id"),

        CONSTRAINT "FK_social_content_destinations_content"
          FOREIGN KEY ("content_item_id")
          REFERENCES "social_content_items" ("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_content_destinations_channel_placement"
        ON "social_content_destinations" (
          "content_item_id",
          "channel",
          "placement"
        )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_content_destinations_scope"
        ON "social_content_destinations" (
          "tenant_id",
          "workspace_id",
          "agency_client_id"
        )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_content_destinations_content"
        ON "social_content_destinations" ("content_item_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_content_destinations_content"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_content_destinations_scope"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_social_content_destinations_channel_placement"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_content_destinations"',
    );

    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_content_items_plan"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_content_items_scope"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "social_content_items"');

    await queryRunner.query('DROP INDEX IF EXISTS "IDX_social_plans_period"');
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_social_plans_scope"');
    await queryRunner.query('DROP TABLE IF EXISTS "social_plans"');
  }
}
