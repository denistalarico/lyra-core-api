import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Planner Visual References — images specific to one content item (product,
 * person, packaging, property, vehicle, environment, apparel, client-provided
 * photo, style). Owned by the Planner; the Creative Studio only reads them
 * (Generation Context) and never copies them into the Brand Kit.
 *
 * A row is a LINK between a content item and a durable `media_assets` row:
 * no binary is copied, the same media may be referenced by several items, and
 * removing a reference removes only the link. Orphaned binaries are a media
 * lifecycle concern (CS3.6), which must count every owner — this table
 * included (FK RESTRICT keeps a referenced media from being deleted).
 *
 * Company Context is enforced by the database, not only by the service:
 *
 *   - the row carries the full four-part scope with the platform's composite
 *     FK to `agency_client_company_contexts`;
 *   - a reference is never legacy: agency scope (client and company NULL) or
 *     client + company. Legacy scopes are invisible in the product (CC2G), and
 *     this keeps CC2G reconciliation — which only moves legacy plans and
 *     legacy media — from ever meeting a reference;
 *   - `TR_social_content_references_scope` (BEFORE INSERT/UPDATE) proves the
 *     item's plan and the media are in exactly the row's scope (IS DISTINCT
 *     FROM, so agency-mode NULLs compare correctly — same pattern as the
 *     Creative Studio triggers) and that the media is an eligible durable
 *     reference: not `temporary:*`, not soft-deleted, an image;
 *   - reverse guards keep the invariant when the OTHER side changes: a media
 *     row (scope, source, mime, deletion), a plan (scope) or a content item
 *     (plan, scope) can no longer be updated into a state that breaks an
 *     existing reference.
 *
 * At most 10 references per item: `sort_order` is 0..9 and unique per item
 * (DEFERRABLE, so a reorder can swap positions inside one transaction).
 *
 * Every statement is re-runnable (specs call `up()` against migrated schemas).
 */
export class CreateSocialContentReferences1798200000000 implements MigrationInterface {
  name = 'CreateSocialContentReferences1798200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_content_references" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "company_context_id" uuid,
        "content_item_id" uuid NOT NULL,
        "media_asset_id" uuid NOT NULL,
        "kind" varchar(40) NOT NULL,
        "label" varchar(240),
        "sort_order" smallint NOT NULL,
        "created_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_social_content_references_content"
          FOREIGN KEY ("content_item_id") REFERENCES "social_content_items" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "FK_social_content_references_media"
          FOREIGN KEY ("media_asset_id") REFERENCES "media_assets" ("id")
          ON DELETE RESTRICT,
        CONSTRAINT "FK_social_content_references_company_context"
          FOREIGN KEY ("company_context_id", "tenant_id", "workspace_id", "agency_client_id")
          REFERENCES "agency_client_company_contexts" ("id", "tenant_id", "workspace_id", "agency_client_id")
          ON DELETE RESTRICT,
        CONSTRAINT "CK_social_content_references_scope"
          CHECK (("agency_client_id" IS NULL) = ("company_context_id" IS NULL)),
        CONSTRAINT "CK_social_content_references_kind"
          CHECK ("kind" ~ '^[a-z][a-z0-9_]{1,39}$'),
        CONSTRAINT "CK_social_content_references_label"
          CHECK ("label" IS NULL OR char_length(btrim("label")) BETWEEN 1 AND 240),
        CONSTRAINT "CK_social_content_references_sort_order"
          CHECK ("sort_order" BETWEEN 0 AND 9),
        CONSTRAINT "UQ_social_content_references_media"
          UNIQUE ("content_item_id", "media_asset_id"),
        CONSTRAINT "UQ_social_content_references_order"
          UNIQUE ("content_item_id", "sort_order") DEFERRABLE INITIALLY DEFERRED
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_content_references_media"
        ON "social_content_references" ("media_asset_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_content_references_scope"
        ON "social_content_references" (
          "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
        )
    `);

    // ── The row itself ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_content_reference_scope()
      RETURNS trigger AS $$
      DECLARE owner record;
      DECLARE media "media_assets"%ROWTYPE;
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
          RAISE EXCEPTION 'content reference must use the company scope of its content item'
            USING ERRCODE = '23514';
        END IF;

        SELECT * INTO media FROM "media_assets" WHERE "id" = NEW."media_asset_id";
        IF NOT FOUND OR
           media."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
           media."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
           media."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
           media."company_context_id" IS DISTINCT FROM NEW."company_context_id" THEN
          RAISE EXCEPTION 'content reference media must use the same company scope'
            USING ERRCODE = '23514';
        END IF;
        IF media."deleted_at" IS NOT NULL OR
           media."source" LIKE 'temporary:%' OR
           media."mime_type" NOT LIKE 'image/%' THEN
          RAISE EXCEPTION 'content reference media must be a durable image'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_content_references_scope" ON "social_content_references"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_content_references_scope"
      BEFORE INSERT OR UPDATE OF
        "content_item_id", "media_asset_id", "tenant_id", "workspace_id",
        "agency_client_id", "company_context_id"
      ON "social_content_references"
      FOR EACH ROW EXECUTE FUNCTION validate_social_content_reference_scope()
    `);

    // ── Reverse guards: the other side may not drift away ─────────────────
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION guard_social_content_reference_media()
      RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "social_content_references" ref
           WHERE ref."media_asset_id" = NEW."id"
             AND (
               ref."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
               ref."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
               ref."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
               ref."company_context_id" IS DISTINCT FROM NEW."company_context_id" OR
               NEW."deleted_at" IS NOT NULL OR
               NEW."source" LIKE 'temporary:%' OR
               NEW."mime_type" NOT LIKE 'image/%'
             )
        ) THEN
          RAISE EXCEPTION 'media is used as a content reference; remove the reference first'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_media_assets_content_reference_guard" ON "media_assets"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_media_assets_content_reference_guard"
      AFTER UPDATE OF
        "tenant_id", "workspace_id", "agency_client_id", "company_context_id",
        "source", "mime_type", "deleted_at"
      ON "media_assets"
      FOR EACH ROW EXECUTE FUNCTION guard_social_content_reference_media()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION guard_social_content_reference_plan()
      RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "social_content_references" ref
            JOIN "social_content_items" item ON item."id" = ref."content_item_id"
           WHERE item."plan_id" = NEW."id"
             AND (
               ref."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
               ref."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
               ref."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
               ref."company_context_id" IS DISTINCT FROM NEW."company_context_id"
             )
        ) THEN
          RAISE EXCEPTION 'plan has content references in its current company scope'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_plans_content_reference_guard" ON "social_plans"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_plans_content_reference_guard"
      AFTER UPDATE OF
        "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
      ON "social_plans"
      FOR EACH ROW EXECUTE FUNCTION guard_social_content_reference_plan()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION guard_social_content_reference_item()
      RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "social_content_references" ref
            JOIN "social_plans" plan ON plan."id" = NEW."plan_id"
           WHERE ref."content_item_id" = NEW."id"
             AND (
               ref."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
               ref."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
               ref."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
               ref."company_context_id" IS DISTINCT FROM plan."company_context_id" OR
               plan."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
               plan."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
               plan."agency_client_id" IS DISTINCT FROM NEW."agency_client_id"
             )
        ) THEN
          RAISE EXCEPTION 'content item has references in its current company scope'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_content_items_content_reference_guard" ON "social_content_items"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_content_items_content_reference_guard"
      AFTER UPDATE OF
        "plan_id", "tenant_id", "workspace_id", "agency_client_id"
      ON "social_content_items"
      FOR EACH ROW EXECUTE FUNCTION guard_social_content_reference_item()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [trigger, table] of [
      [
        'TR_social_content_items_content_reference_guard',
        'social_content_items',
      ],
      ['TR_social_plans_content_reference_guard', 'social_plans'],
      ['TR_media_assets_content_reference_guard', 'media_assets'],
    ] as const)
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS "${trigger}" ON "${table}"`,
      );
    await queryRunner.query('DROP TABLE IF EXISTS "social_content_references"');
    for (const fn of [
      'guard_social_content_reference_item',
      'guard_social_content_reference_plan',
      'guard_social_content_reference_media',
      'validate_social_content_reference_scope',
    ])
      await queryRunner.query(`DROP FUNCTION IF EXISTS ${fn}()`);
  }
}
