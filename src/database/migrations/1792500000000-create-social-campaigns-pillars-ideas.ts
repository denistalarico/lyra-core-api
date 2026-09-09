import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Social campaigns, editorial pillars and the idea backlog (Planner E5).
 *
 * FOUR TABLES, ONE MIGRATION. They ship together because the two columns added
 * to social_content_items at the end reference two of them; splitting the
 * migration would leave a window where the column exists and its target table
 * does not.
 *
 * WHY CAMPAIGNS ARE NOT A PLANNER TABLE
 * -------------------------------------
 * A campaign is a cross-Social context, not a Planner-owned object. Creative
 * Studio will attach assets to one and Ads will attach paid delivery to one,
 * so the scope triple here is the Social operational context
 * (tenant/workspace/agencyClientId) and NOT the plan. A campaign deliberately
 * has no plan_id: "Natal 2026" spans November and December plans, and pinning
 * it to one of them would make the other plan's content unattachable.
 *
 * The permission keys these tables answer to already exist in the catalog as
 * `social.campaigns.campaign.*` — further evidence the concept was always
 * intended to live outside the Planner module.
 *
 * WHY THE BACKLOG IS ITS OWN TABLE
 * --------------------------------
 * social_content_items.plan_id is NOT NULL, and it must stay that way. Making
 * it nullable to host dateless ideas would silently change every existing
 * Planner query: a scope-only `where` currently cannot match content outside a
 * plan, and after such a change it would. An idea is also a genuinely
 * different object — it has no destinations, no revisions and no publication —
 * so it gets its own table and an explicit conversion into a content item.
 */
export class CreateSocialCampaignsPillarsIdeas1792500000000
  implements MigrationInterface
{
  name = 'CreateSocialCampaignsPillarsIdeas1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_campaign_templates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),

        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        "name" varchar(240) NOT NULL,
        "description" text,
        "objective" varchar(120),

        "default_duration_days" integer,

        "recommended_pillars" jsonb NOT NULL DEFAULT '[]'::jsonb,

        "is_active" boolean NOT NULL DEFAULT true,

        "created_by_id" uuid,
        "updated_by_id" uuid,

        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_campaign_templates" PRIMARY KEY ("id"),

        CONSTRAINT "CK_social_campaign_templates_pillars_array"
          CHECK (jsonb_typeof("recommended_pillars") = 'array'),

        CONSTRAINT "CK_social_campaign_templates_duration"
          CHECK (
            "default_duration_days" IS NULL OR "default_duration_days" > 0
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_campaign_templates_scope"
        ON "social_campaign_templates" (
          "tenant_id", "workspace_id", "agency_client_id"
        )
    `);

    /**
     * Name uniqueness is split into two partial indexes because a plain
     * UNIQUE over the scope triple would not constrain agency-level rows at
     * all: in Postgres, NULL is distinct from NULL, so two agency campaigns
     * named "Natal 2026" would both be accepted.
     */
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_campaign_templates_agency_name"
        ON "social_campaign_templates" ("tenant_id", "workspace_id", "name")
        WHERE "agency_client_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_campaign_templates_client_name"
        ON "social_campaign_templates" (
          "tenant_id", "workspace_id", "agency_client_id", "name"
        )
        WHERE "agency_client_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_campaign_instances" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),

        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        /**
         * The template this campaign was created from, when it was created
         * from one. ON DELETE SET NULL: removing a template must not remove
         * the campaign that is already running.
         */
        "template_id" uuid,

        "name" varchar(240) NOT NULL,
        "description" text,
        "objective" varchar(120),

        "starts_on" date,
        "ends_on" date,

        "status" varchar(32) NOT NULL DEFAULT 'planned',

        "color" varchar(16),

        "created_by_id" uuid,
        "updated_by_id" uuid,

        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_campaign_instances" PRIMARY KEY ("id"),

        CONSTRAINT "FK_social_campaign_instances_template"
          FOREIGN KEY ("template_id")
          REFERENCES "social_campaign_templates" ("id")
          ON DELETE SET NULL,

        CONSTRAINT "CK_social_campaign_instances_status"
          CHECK (
            "status" IN ('planned', 'active', 'completed', 'archived')
          ),

        CONSTRAINT "CK_social_campaign_instances_period"
          CHECK (
            "starts_on" IS NULL
            OR "ends_on" IS NULL
            OR "ends_on" >= "starts_on"
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_campaign_instances_scope"
        ON "social_campaign_instances" (
          "tenant_id", "workspace_id", "agency_client_id"
        )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_campaign_instances_period"
        ON "social_campaign_instances" (
          "tenant_id", "workspace_id", "agency_client_id",
          "starts_on", "ends_on"
        )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_campaign_instances_agency_name"
        ON "social_campaign_instances" ("tenant_id", "workspace_id", "name")
        WHERE "agency_client_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_campaign_instances_client_name"
        ON "social_campaign_instances" (
          "tenant_id", "workspace_id", "agency_client_id", "name"
        )
        WHERE "agency_client_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_editorial_pillars" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),

        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        /**
         * Stable machine key so coverage can be reported across renames.
         * The label is what an operator sees and may change freely.
         */
        "key" varchar(80) NOT NULL,
        "label" varchar(160) NOT NULL,
        "description" text,

        /**
         * Share of the plan this pillar should occupy, as a percentage.
         * NULL means "tracked but without a target" — coverage still counts
         * the content, it simply has nothing to compare against.
         */
        "target_percentage" numeric(5, 2),

        "color" varchar(16),
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,

        "created_by_id" uuid,
        "updated_by_id" uuid,

        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_editorial_pillars" PRIMARY KEY ("id"),

        CONSTRAINT "CK_social_editorial_pillars_key"
          CHECK ("key" ~ '^[a-z0-9][a-z0-9_-]*$'),

        CONSTRAINT "CK_social_editorial_pillars_target"
          CHECK (
            "target_percentage" IS NULL
            OR ("target_percentage" >= 0 AND "target_percentage" <= 100)
          ),

        CONSTRAINT "CK_social_editorial_pillars_sort_order"
          CHECK ("sort_order" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_editorial_pillars_scope"
        ON "social_editorial_pillars" (
          "tenant_id", "workspace_id", "agency_client_id"
        )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_editorial_pillars_agency_key"
        ON "social_editorial_pillars" ("tenant_id", "workspace_id", "key")
        WHERE "agency_client_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_editorial_pillars_client_key"
        ON "social_editorial_pillars" (
          "tenant_id", "workspace_id", "agency_client_id", "key"
        )
        WHERE "agency_client_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_content_ideas" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),

        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        "title" varchar(240) NOT NULL,
        "notes" text,

        /**
         * Optional editorial hints an idea may already carry. None of them is
         * required: the whole point of the backlog is that an idea exists
         * before it has a date, a plan or a format.
         */
        "pillar_id" uuid,
        "campaign_instance_id" uuid,
        "funnel_stage" varchar(80),
        "content_type" varchar(80),

        "status" varchar(32) NOT NULL DEFAULT 'open',

        "priority" integer NOT NULL DEFAULT 0,

        "source" varchar(40) NOT NULL DEFAULT 'manual',

        /**
         * Set when the idea becomes planned content. Kept as a plain uuid
         * without a foreign key: deleting the content item must not delete the
         * backlog history that produced it, and the Planner has no cascade
         * story for content deletion today.
         */
        "converted_content_item_id" uuid,
        "converted_at" timestamptz,

        "created_by_id" uuid,
        "updated_by_id" uuid,

        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_content_ideas" PRIMARY KEY ("id"),

        CONSTRAINT "FK_social_content_ideas_pillar"
          FOREIGN KEY ("pillar_id")
          REFERENCES "social_editorial_pillars" ("id")
          ON DELETE SET NULL,

        CONSTRAINT "FK_social_content_ideas_campaign"
          FOREIGN KEY ("campaign_instance_id")
          REFERENCES "social_campaign_instances" ("id")
          ON DELETE SET NULL,

        CONSTRAINT "CK_social_content_ideas_status"
          CHECK ("status" IN ('open', 'converted', 'discarded')),

        CONSTRAINT "CK_social_content_ideas_priority"
          CHECK ("priority" >= 0),

        /**
         * A converted idea must say what it became, and an unconverted one
         * must not claim a content item. This is the invariant the backlog
         * exists to protect: an idea silently marked converted with no target
         * is a pauta that disappeared.
         */
        CONSTRAINT "CK_social_content_ideas_conversion"
          CHECK (
            ("status" = 'converted') = ("converted_content_item_id" IS NOT NULL)
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_content_ideas_scope"
        ON "social_content_ideas" (
          "tenant_id", "workspace_id", "agency_client_id"
        )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_content_ideas_backlog"
        ON "social_content_ideas" (
          "tenant_id", "workspace_id", "agency_client_id",
          "status", "priority"
        )
    `);

    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        ADD COLUMN IF NOT EXISTS "campaign_instance_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        ADD COLUMN IF NOT EXISTS "editorial_pillar_id" uuid
    `);

    /**
     * ON DELETE SET NULL on both: removing a campaign or a pillar is an
     * editorial decision about the taxonomy, never a reason to delete planned
     * content. The content simply becomes unclassified.
     *
     * Added defensively because ADD CONSTRAINT has no IF NOT EXISTS and this
     * migration must stay re-runnable like every other one in this datasource.
     */
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_social_content_items_campaign'
        ) THEN
          ALTER TABLE "social_content_items"
            ADD CONSTRAINT "FK_social_content_items_campaign"
            FOREIGN KEY ("campaign_instance_id")
            REFERENCES "social_campaign_instances" ("id")
            ON DELETE SET NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_social_content_items_pillar'
        ) THEN
          ALTER TABLE "social_content_items"
            ADD CONSTRAINT "FK_social_content_items_pillar"
            FOREIGN KEY ("editorial_pillar_id")
            REFERENCES "social_editorial_pillars" ("id")
            ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_content_items_campaign"
        ON "social_content_items" ("campaign_instance_id")
        WHERE "campaign_instance_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_content_items_pillar"
        ON "social_content_items" ("editorial_pillar_id")
        WHERE "editorial_pillar_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_content_items_pillar"',
    );

    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_content_items_campaign"',
    );

    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        DROP CONSTRAINT IF EXISTS "FK_social_content_items_pillar"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        DROP CONSTRAINT IF EXISTS "FK_social_content_items_campaign"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        DROP COLUMN IF EXISTS "editorial_pillar_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "social_content_items"
        DROP COLUMN IF EXISTS "campaign_instance_id"
    `);

    await queryRunner.query('DROP TABLE IF EXISTS "social_content_ideas"');

    await queryRunner.query('DROP TABLE IF EXISTS "social_editorial_pillars"');

    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_campaign_instances"',
    );

    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_campaign_templates"',
    );
  }
}
