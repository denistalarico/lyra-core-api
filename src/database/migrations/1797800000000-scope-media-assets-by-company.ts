import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CS3.1.1 — every known owner of a media row, with the owner's full scope.
 *
 * Creative versions carry their asset's company directly; Planner bindings
 * and publications carry it through `social_content_items → social_plans`.
 * Shared with the reconciliation registry's reasoning: a media row's company
 * is a fact of its owners, never of the media row itself.
 */
const MEDIA_ASSET_OWNERS_SQL = `
  SELECT version."media_asset_id" AS "media_asset_id",
         asset."tenant_id", asset."workspace_id", asset."agency_client_id",
         asset."company_context_id"
    FROM "social_creative_asset_versions" version
    JOIN "social_creative_assets" asset ON asset."id" = version."creative_asset_id"
  UNION ALL
  SELECT version."thumbnail_media_asset_id",
         asset."tenant_id", asset."workspace_id", asset."agency_client_id",
         asset."company_context_id"
    FROM "social_creative_asset_versions" version
    JOIN "social_creative_assets" asset ON asset."id" = version."creative_asset_id"
   WHERE version."thumbnail_media_asset_id" IS NOT NULL
  UNION ALL
  SELECT binding."media_asset_id",
         plan."tenant_id", plan."workspace_id", plan."agency_client_id",
         plan."company_context_id"
    FROM "social_destination_creatives" binding
    JOIN "social_content_items" item ON item."id" = binding."content_item_id"
    JOIN "social_plans" plan ON plan."id" = item."plan_id"
  UNION ALL
  SELECT media."media_asset_id",
         plan."tenant_id", plan."workspace_id", plan."agency_client_id",
         plan."company_context_id"
    FROM "social_publication_media" media
    JOIN "social_publications" publication ON publication."id" = media."publication_id"
    JOIN "social_content_items" item ON item."id" = publication."content_item_id"
    JOIN "social_plans" plan ON plan."id" = item."plan_id"
  UNION ALL
  SELECT publication."media_asset_id",
         plan."tenant_id", plan."workspace_id", plan."agency_client_id",
         plan."company_context_id"
    FROM "social_publications" publication
    JOIN "social_content_items" item ON item."id" = publication."content_item_id"
    JOIN "social_plans" plan ON plan."id" = item."plan_id"
   WHERE publication."media_asset_id" IS NOT NULL
`;

/**
 * CS3.1.1 — Company Context on `media_assets`.
 *
 * Until now the shared media boundary isolated by tenant/workspace/client
 * only, so Company A and Company B of one client could list, bind and publish
 * each other's media. This adds the CC2C shape (nullable column, CHECK that a
 * company implies a client, composite FK to the company's own scope).
 *
 * BACKFILL — no guessing, two deterministic rules, in order:
 *
 *   1. Owned media follows its owners. A client-scoped row whose owners all
 *      share its tenant/workspace/client and exactly one non-null company
 *      takes that company. Any legacy (null-company) owner, any owner in a
 *      different scope, or owners in two companies leave it legacy.
 *   2. Unowned media follows the CC2C rule: assigned only when the client has
 *      exactly ONE company — the only company it can belong to.
 *
 * Everything else stays `(agency_client_id, NULL)` — legacy_unassigned,
 * invisible to operational requests (CC2G), exactly like the other Social
 * roots. Agency rows `(NULL, NULL)` are untouched. No row is deleted and no
 * object or bucket is touched.
 */
export class ScopeMediaAssetsByCompany1797800000000 implements MigrationInterface {
  name = 'ScopeMediaAssetsByCompany1797800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "media_assets" ADD COLUMN IF NOT EXISTS "company_context_id" uuid',
    );

    await queryRunner.query(`
      WITH owners AS (${MEDIA_ASSET_OWNERS_SQL}),
      verdicts AS (
        SELECT owner."media_asset_id",
               count(DISTINCT owner."company_context_id") AS "companies",
               bool_or(owner."company_context_id" IS NULL) AS "any_legacy",
               bool_or(
                 owner."tenant_id" IS DISTINCT FROM media."tenant_id" OR
                 owner."workspace_id" IS DISTINCT FROM media."workspace_id" OR
                 owner."agency_client_id" IS DISTINCT FROM media."agency_client_id"
               ) AS "any_foreign",
               min(owner."company_context_id"::text)::uuid AS "company_context_id"
          FROM owners owner
          JOIN "media_assets" media ON media."id" = owner."media_asset_id"
         GROUP BY owner."media_asset_id"
      )
      UPDATE "media_assets" AS media
         SET "company_context_id" = verdicts."company_context_id"
        FROM verdicts
       WHERE media."id" = verdicts."media_asset_id"
         AND media."company_context_id" IS NULL
         AND media."agency_client_id" IS NOT NULL
         AND verdicts."companies" = 1
         AND NOT verdicts."any_legacy"
         AND NOT verdicts."any_foreign"
    `);

    await queryRunner.query(`
      WITH owners AS (${MEDIA_ASSET_OWNERS_SQL}),
      candidates AS (
        SELECT "tenant_id", "workspace_id", "agency_client_id",
               (array_agg("id" ORDER BY "id"))[1] AS "company_context_id",
               count(*) AS "context_count"
          FROM "agency_client_company_contexts"
         GROUP BY "tenant_id", "workspace_id", "agency_client_id"
      )
      UPDATE "media_assets" AS media
         SET "company_context_id" = candidates."company_context_id"
        FROM candidates
       WHERE media."company_context_id" IS NULL
         AND media."agency_client_id" IS NOT NULL
         AND candidates."tenant_id" = media."tenant_id"
         AND candidates."workspace_id" = media."workspace_id"
         AND candidates."agency_client_id" = media."agency_client_id"
         AND candidates."context_count" = 1
         AND NOT EXISTS (
           SELECT 1 FROM owners WHERE owners."media_asset_id" = media."id"
         )
    `);

    // Re-runnable: drop-then-add, so a second `up()` converges.
    await queryRunner.query(`
      ALTER TABLE "media_assets"
        DROP CONSTRAINT IF EXISTS "FK_media_assets_company_context",
        DROP CONSTRAINT IF EXISTS "CK_media_assets_company_scope",
        ADD CONSTRAINT "CK_media_assets_company_scope"
          CHECK ("company_context_id" IS NULL OR "agency_client_id" IS NOT NULL),
        ADD CONSTRAINT "FK_media_assets_company_context"
          FOREIGN KEY (
            "company_context_id", "tenant_id", "workspace_id", "agency_client_id"
          )
          REFERENCES "agency_client_company_contexts" (
            "id", "tenant_id", "workspace_id", "agency_client_id"
          )
          ON DELETE RESTRICT
    `);

    await queryRunner.query('DROP INDEX IF EXISTS "IDX_media_assets_scope"');
    await queryRunner.query(`
      CREATE INDEX "IDX_media_assets_scope"
        ON "media_assets" (
          "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
        )
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_media_assets_scope_checksum"',
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_media_assets_scope_checksum"
        ON "media_assets" (
          "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "checksum"
        )
        WHERE "checksum" IS NOT NULL
    `);

    // A version (and therefore a promoted generation) can only point at media
    // of its own asset's full scope — the CS3 promotion invariant as a fact
    // of the database. Version rows are immutable, so existing pairs are not
    // re-validated; the backfill above already aligned them with their owner.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_social_creative_version_media_scope()
      RETURNS trigger AS $$
      DECLARE asset_scope record;
      DECLARE media_scope record;
      BEGIN
        SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
          INTO asset_scope
          FROM "social_creative_assets" WHERE "id" = NEW."creative_asset_id";
        FOR media_scope IN
          SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
            FROM "media_assets"
           WHERE "id" IN (NEW."media_asset_id", NEW."thumbnail_media_asset_id")
        LOOP
          IF media_scope."tenant_id" IS DISTINCT FROM asset_scope."tenant_id" OR
             media_scope."workspace_id" IS DISTINCT FROM asset_scope."workspace_id" OR
             media_scope."agency_client_id" IS DISTINCT FROM asset_scope."agency_client_id" OR
             media_scope."company_context_id" IS DISTINCT FROM asset_scope."company_context_id" THEN
            RAISE EXCEPTION 'creative version media must use the same company scope'
              USING ERRCODE = '23514';
          END IF;
        END LOOP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_asset_versions_media_scope" ON "social_creative_asset_versions"',
    );
    await queryRunner.query(`
      CREATE TRIGGER "TR_social_creative_asset_versions_media_scope"
      BEFORE INSERT OR UPDATE OF
        "creative_asset_id", "media_asset_id", "thumbnail_media_asset_id"
      ON "social_creative_asset_versions"
      FOR EACH ROW EXECUTE FUNCTION validate_social_creative_version_media_scope()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_social_creative_asset_versions_media_scope" ON "social_creative_asset_versions"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS validate_social_creative_version_media_scope()',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_media_assets_scope_checksum"',
    );
    await queryRunner.query(`
      CREATE INDEX "IDX_media_assets_scope_checksum"
        ON "media_assets" ("tenant_id", "workspace_id", "agency_client_id", "checksum")
        WHERE "checksum" IS NOT NULL
    `);
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_media_assets_scope"');
    await queryRunner.query(`
      CREATE INDEX "IDX_media_assets_scope"
        ON "media_assets" ("tenant_id", "workspace_id", "agency_client_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "media_assets"
        DROP CONSTRAINT IF EXISTS "FK_media_assets_company_context",
        DROP CONSTRAINT IF EXISTS "CK_media_assets_company_scope",
        DROP COLUMN IF EXISTS "company_context_id"
    `);
  }
}
