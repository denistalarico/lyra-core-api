import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CS5-B — Creative Production Integration.
 *
 * Three additions, all owned by the Creative Studio except the column on the
 * Planner's destination link, and none of them a copy of another owner's state:
 *
 * 1. `social_creative_productions` — one row per Planner content item. It holds
 *    the EXPLICIT selection (`selected_version_id` is authoritative; the asset
 *    id is there for navigation and for the asset-level guards) and an optional
 *    link to existing Agency work (task, subtask, project). No status column:
 *    readiness is derived on read from Studio, Approvals and the Planner.
 *    The Agency ids carry no FK on purpose: tasks are client-scoped, hard
 *    deletable by their owner and live in another product; a Social FK would
 *    either block the Agency's own delete (RESTRICT) or let it rewrite Social
 *    rows (CASCADE/SET NULL). A missing task is reconciled on read.
 *
 * 2. `social_creative_production_events` — the domain's append-only history
 *    (the platform pattern is one `<domain>_events` table per domain). Ids are
 *    evidence, so no FKs: the log outlives anything it names.
 *
 * 3. `social_destination_creatives.creative_version_id` — the immutable version
 *    a destination creative was handed off from. NULL for every existing row
 *    and for manual choices: no backfill guess. The trigger proves that the row
 *    carries exactly that version's media, so a later version can never be
 *    attributed to an old link.
 *
 * Database guards (Company Context and immutability are not only service
 * rules, same standard as CS3/CS4 and Planner Visual References):
 *
 *   - `TR_social_creative_productions_guard`: the row uses the full scope of its
 *     content item's plan; the selected version belongs to the selected asset;
 *     the asset is in the same scope, is not archived (read under FOR SHARE, so
 *     a concurrent archive serializes against it) and is not produced for a
 *     different content item.
 *   - `TR_social_creative_assets_selection_guard`: an asset whose version is the
 *     selection of a live (not deleted) content item cannot be archived. The
 *     operator changes or clears the selection first; nothing cascades.
 *   - `TR_social_destination_creatives_version_guard`: version media = row media,
 *     same tenant/workspace/client.
 *
 * Every statement is re-runnable (specs call `up()` against migrated schemas).
 */
export class CreateSocialCreativeProductions1798700000000 implements MigrationInterface {
  name = 'CreateSocialCreativeProductions1798700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_creative_productions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "company_context_id" uuid,
        "content_item_id" uuid NOT NULL,
        "selected_creative_asset_id" uuid,
        "selected_version_id" uuid,
        "selected_by_id" uuid,
        "selected_at" timestamptz,
        "task_id" uuid,
        "subtask_id" uuid,
        "project_id" uuid,
        "task_link_kind" varchar(16),
        "task_linked_by_id" uuid,
        "task_linked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_social_creative_productions_content"
          UNIQUE ("content_item_id"),
        CONSTRAINT "FK_social_creative_productions_content"
          FOREIGN KEY ("content_item_id") REFERENCES "social_content_items" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_social_creative_productions_asset"
          FOREIGN KEY ("selected_creative_asset_id")
          REFERENCES "social_creative_assets" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_social_creative_productions_version"
          FOREIGN KEY ("selected_version_id")
          REFERENCES "social_creative_asset_versions" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_social_creative_productions_company_context"
          FOREIGN KEY ("company_context_id", "tenant_id", "workspace_id", "agency_client_id")
          REFERENCES "agency_client_company_contexts" ("id", "tenant_id", "workspace_id", "agency_client_id")
          ON DELETE RESTRICT,
        CONSTRAINT "CK_social_creative_productions_scope"
          CHECK (("agency_client_id" IS NULL) = ("company_context_id" IS NULL)),
        CONSTRAINT "CK_social_creative_productions_selection"
          CHECK (
            ("selected_version_id" IS NULL) = ("selected_creative_asset_id" IS NULL)
            AND ("selected_version_id" IS NULL) = ("selected_at" IS NULL)
          ),
        CONSTRAINT "CK_social_creative_productions_task"
          CHECK (
            (
              "task_id" IS NULL AND "subtask_id" IS NULL AND "project_id" IS NULL
              AND "task_link_kind" IS NULL AND "task_linked_at" IS NULL
            ) OR (
              "task_id" IS NOT NULL AND "task_linked_at" IS NOT NULL
              AND "task_link_kind" IN ('linked', 'created')
            )
          )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_productions_scope"
        ON "social_creative_productions" (
          "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
        )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_productions_version"
        ON "social_creative_productions" ("selected_version_id")
        WHERE "selected_version_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_productions_asset"
        ON "social_creative_productions" ("selected_creative_asset_id")
        WHERE "selected_creative_asset_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_productions_task"
        ON "social_creative_productions" ("task_id")
        WHERE "task_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_creative_production_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "company_context_id" uuid,
        "content_item_id" uuid NOT NULL,
        "event_type" varchar(80) NOT NULL,
        "creative_version_id" uuid,
        "actor_user_id" uuid,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "occurred_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_social_creative_production_events_scope"
          CHECK (("agency_client_id" IS NULL) = ("company_context_id" IS NULL)),
        CONSTRAINT "CK_social_creative_production_events_type"
          CHECK ("event_type" ~ '^social\\.creative\\.[a-z_.]{3,60}$'),
        CONSTRAINT "CK_social_creative_production_events_payload"
          CHECK (jsonb_typeof("payload") = 'object')
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_creative_production_events_content"
        ON "social_creative_production_events" ("content_item_id", "occurred_at")
    `);

    // ── Destination link: exact immutable version ─────────────────────────
    await queryRunner.query(`
      ALTER TABLE "social_destination_creatives"
        ADD COLUMN IF NOT EXISTS "creative_version_id" uuid
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conname = 'FK_social_destination_creatives_creative_version'
             AND conrelid = '"social_destination_creatives"'::regclass
        ) THEN
          ALTER TABLE "social_destination_creatives"
            ADD CONSTRAINT "FK_social_destination_creatives_creative_version"
            FOREIGN KEY ("creative_version_id")
            REFERENCES "social_creative_asset_versions" ("id")
            ON DELETE RESTRICT;
        END IF;
      END $$
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_destination_creatives_version"
        ON "social_destination_creatives" ("creative_version_id")
        WHERE "creative_version_id" IS NOT NULL
    `);

    // ── Guards ────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_creative_production()
      RETURNS trigger AS $$
      DECLARE owner record;
      DECLARE asset record;
      DECLARE version_asset uuid;
      BEGIN
        SELECT item."tenant_id" AS item_tenant, item."workspace_id" AS item_workspace,
               item."agency_client_id" AS item_client,
               plan."tenant_id", plan."workspace_id", plan."agency_client_id",
               plan."company_context_id"
          INTO owner
          FROM "social_content_items" item
          JOIN "social_plans" plan ON plan."id" = item."plan_id"
         WHERE item."id" = NEW."content_item_id";
        IF NOT FOUND OR
           owner.item_tenant IS DISTINCT FROM NEW."tenant_id" OR
           owner.item_workspace IS DISTINCT FROM NEW."workspace_id" OR
           owner.item_client IS DISTINCT FROM NEW."agency_client_id" OR
           owner."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
           owner."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
           owner."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
           owner."company_context_id" IS DISTINCT FROM NEW."company_context_id" THEN
          RAISE EXCEPTION 'creative production must use the company scope of its content item'
            USING ERRCODE = '23514', CONSTRAINT = 'TR_social_creative_productions_scope';
        END IF;

        IF NEW."selected_version_id" IS NOT NULL AND (
             TG_OP = 'INSERT' OR
             NEW."selected_version_id" IS DISTINCT FROM OLD."selected_version_id" OR
             NEW."selected_creative_asset_id" IS DISTINCT FROM OLD."selected_creative_asset_id"
           ) THEN
          SELECT v."creative_asset_id" INTO version_asset
            FROM "social_creative_asset_versions" v
           WHERE v."id" = NEW."selected_version_id";
          IF NOT FOUND OR version_asset IS DISTINCT FROM NEW."selected_creative_asset_id" THEN
            RAISE EXCEPTION 'selected version must belong to the selected creative asset'
              USING ERRCODE = '23514', CONSTRAINT = 'TR_social_creative_productions_version';
          END IF;
          -- FOR SHARE: an archive running at the same time waits for this
          -- transaction (or this one waits for it and then sees 'archived').
          SELECT a."tenant_id", a."workspace_id", a."agency_client_id",
                 a."company_context_id", a."status", a."content_item_id"
            INTO asset
            FROM "social_creative_assets" a
           WHERE a."id" = NEW."selected_creative_asset_id"
             FOR SHARE;
          IF NOT FOUND OR
             asset."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
             asset."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
             asset."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
             asset."company_context_id" IS DISTINCT FROM NEW."company_context_id" THEN
            RAISE EXCEPTION 'selected creative must use the company scope of the production'
              USING ERRCODE = '23514', CONSTRAINT = 'TR_social_creative_productions_scope';
          END IF;
          IF asset."status" <> 'ready' THEN
            RAISE EXCEPTION 'an archived creative cannot be selected'
              USING ERRCODE = '23514', CONSTRAINT = 'TR_social_creative_productions_archived';
          END IF;
          IF asset."content_item_id" IS NOT NULL AND
             asset."content_item_id" <> NEW."content_item_id" THEN
            RAISE EXCEPTION 'creative was produced for another content item'
              USING ERRCODE = '23514', CONSTRAINT = 'TR_social_creative_productions_content';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_productions_guard" ON "social_creative_productions"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_creative_productions_guard"
      BEFORE INSERT OR UPDATE ON "social_creative_productions"
      FOR EACH ROW EXECUTE FUNCTION validate_social_creative_production()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION guard_social_creative_asset_selection()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."status" = 'archived' AND OLD."status" IS DISTINCT FROM 'archived' AND EXISTS (
          SELECT 1 FROM "social_creative_productions" p
            JOIN "social_content_items" item ON item."id" = p."content_item_id"
           WHERE p."selected_creative_asset_id" = NEW."id"
             AND item."deleted_at" IS NULL
        ) THEN
          RAISE EXCEPTION 'creative is the selected version of a content item'
            USING ERRCODE = '23514', CONSTRAINT = 'TR_social_creative_assets_selection_guard';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_assets_selection_guard" ON "social_creative_assets"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_creative_assets_selection_guard"
      BEFORE UPDATE OF "status" ON "social_creative_assets"
      FOR EACH ROW EXECUTE FUNCTION guard_social_creative_asset_selection()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_destination_creative_version()
      RETURNS trigger AS $$
      DECLARE source record;
      BEGIN
        IF NEW."creative_version_id" IS NULL THEN
          RETURN NEW;
        END IF;
        SELECT version."media_asset_id", asset."tenant_id", asset."workspace_id",
               asset."agency_client_id"
          INTO source
          FROM "social_creative_asset_versions" version
          JOIN "social_creative_assets" asset ON asset."id" = version."creative_asset_id"
         WHERE version."id" = NEW."creative_version_id";
        IF NOT FOUND OR
           source."media_asset_id" IS DISTINCT FROM NEW."media_asset_id" OR
           source."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
           source."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
           source."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" THEN
          RAISE EXCEPTION 'destination creative must carry the exact media of its creative version'
            USING ERRCODE = '23514', CONSTRAINT = 'TR_social_destination_creatives_version_guard';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_destination_creatives_version_guard" ON "social_destination_creatives"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_destination_creatives_version_guard"
      BEFORE INSERT OR UPDATE OF
        "creative_version_id", "media_asset_id", "tenant_id", "workspace_id",
        "agency_client_id"
      ON "social_destination_creatives"
      FOR EACH ROW EXECUTE FUNCTION validate_social_destination_creative_version()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_destination_creatives_version_guard" ON "social_destination_creatives"',
    );
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_assets_selection_guard" ON "social_creative_assets"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_social_destination_creatives_version"',
    );
    await queryRunner.query(`
      ALTER TABLE "social_destination_creatives"
        DROP CONSTRAINT IF EXISTS "FK_social_destination_creatives_creative_version"
    `);
    await queryRunner.query(`
      ALTER TABLE "social_destination_creatives"
        DROP COLUMN IF EXISTS "creative_version_id"
    `);
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_creative_production_events"',
    );
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_creative_productions"',
    );
    for (const fn of [
      'validate_social_destination_creative_version',
      'guard_social_creative_asset_selection',
      'validate_social_creative_production',
    ])
      await queryRunner.query(`DROP FUNCTION IF EXISTS ${fn}()`);
  }
}
