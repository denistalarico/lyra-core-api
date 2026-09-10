import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The creative chosen for each editorial destination (Planner E5).
 *
 * WHY A TABLE AND NOT A COLUMN
 * ----------------------------
 * Putting `media_asset_id` on `social_content_items` would allow one creative
 * per content item, which defeats the whole point of E5: a Story and a Feed
 * post on the same item need different files. Putting it on
 * `social_content_destinations` would lose it on every destination edit —
 * `replaceDestinations` deletes and reinserts the entire set.
 *
 * FOREIGN KEY POLICY, ONE ROW AT A TIME
 * -------------------------------------
 *   - `destination_id` CASCADE: the link is meaningless without its
 *     destination, and destination replacement is a routine editorial action.
 *     Deliberately different from the RESTRICT that protects publications.
 *   - `content_item_id` CASCADE: same lifecycle as the destination it was
 *     denormalized from.
 *   - `media_asset_id` RESTRICT: a file an operator has chosen for a scheduled
 *     destination cannot be deleted out from under it. Historical publications
 *     are already protected by their own RESTRICT
 *     (`FK_social_publications_media_asset`) and this changes nothing about
 *     them — a publication's evidence survives the deletion of every editorial
 *     link that produced it.
 *   - `organic_asset_id` RESTRICT: the recorded validation names this account.
 *     Letting the account vanish would leave a link claiming it was checked
 *     against something that no longer exists.
 *
 * ONE PRIMARY CREATIVE PER DESTINATION
 * ------------------------------------
 * The unique index is partial on `role = 'primary'` rather than a plain UNIQUE
 * on `destination_id`. That admits the future carousel rows (`slide`, `cover`)
 * without a second migration while making today's invariant — exactly one
 * publishable creative per destination — a database guarantee rather than a
 * service convention. Carousel stays out of scope in this campaign because the
 * publication contract persists a single `media_asset_id`.
 *
 * SCOPE COLUMNS ARE NOT REDUNDANT
 * -------------------------------
 * They are reachable through the destination, but every query in this domain
 * filters resource AND scope simultaneously, and a join-derived scope cannot
 * be indexed for that pattern. The service always copies them from the
 * resolved destination, never from a request body.
 */
export class CreateSocialDestinationCreatives1792600000000 implements MigrationInterface {
  name = 'CreateSocialDestinationCreatives1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_destination_creatives" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),

        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,

        "destination_id" uuid NOT NULL,
        "content_item_id" uuid NOT NULL,

        "media_asset_id" uuid NOT NULL,
        "organic_asset_id" uuid NOT NULL,

        "role" varchar(40) NOT NULL DEFAULT 'primary',
        "sort_order" integer NOT NULL DEFAULT 0,
        "source" varchar(40) NOT NULL DEFAULT 'manual',

        "created_by_id" uuid,

        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),

        CONSTRAINT "PK_social_destination_creatives" PRIMARY KEY ("id"),

        CONSTRAINT "FK_social_destination_creatives_destination"
          FOREIGN KEY ("destination_id")
          REFERENCES "social_content_destinations" ("id")
          ON DELETE CASCADE,

        CONSTRAINT "FK_social_destination_creatives_content_item"
          FOREIGN KEY ("content_item_id")
          REFERENCES "social_content_items" ("id")
          ON DELETE CASCADE,

        CONSTRAINT "FK_social_destination_creatives_media_asset"
          FOREIGN KEY ("media_asset_id")
          REFERENCES "media_assets" ("id")
          ON DELETE RESTRICT,

        CONSTRAINT "FK_social_destination_creatives_organic_asset"
          FOREIGN KEY ("organic_asset_id")
          REFERENCES "social_organic_assets" ("id")
          ON DELETE RESTRICT,

        CONSTRAINT "CK_social_destination_creatives_role"
          CHECK ("role" ~ '^[a-z0-9][a-z0-9_-]*$'),

        CONSTRAINT "CK_social_destination_creatives_source"
          CHECK ("source" ~ '^[a-z0-9][a-z0-9_-]*$'),

        CONSTRAINT "CK_social_destination_creatives_sort_order"
          CHECK ("sort_order" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_destination_creatives_scope"
        ON "social_destination_creatives" (
          "tenant_id", "workspace_id", "agency_client_id"
        )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_destination_creatives_destination"
        ON "social_destination_creatives" ("destination_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_destination_creatives_content"
        ON "social_destination_creatives" ("content_item_id")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_social_destination_creatives_primary"
        ON "social_destination_creatives" ("destination_id")
        WHERE "role" = 'primary'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "social_destination_creatives"',
    );
  }
}
