import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brand Kit foundation — the single migration of the S1.4.x cycle (D-14).
 *
 * Two new tables, no change to any existing one: purely additive, so nothing
 * the Agency or the suite-web serves today is touched.
 *
 * The uniqueness rules are the point of this migration. `brand_kits` is
 * scoped by `tenant_id` + `workspace_id` + a NULLABLE `agency_client_id`, and
 * in Postgres `NULL` is never equal to `NULL` for uniqueness — so the obvious
 * `UNIQUE (tenant_id, workspace_id, agency_client_id)` would enforce nothing
 * at all for the agency context: N agency rows could coexist, and a
 * double-clicked "create" would produce two Brand Kits for the same agency
 * with no error. The correct form is two PARTIAL unique indexes, split on
 * `IS NULL` / `IS NOT NULL`, which is the pattern
 * `leadflow_business_mode_templates` already uses in this schema.
 *
 * See docs/architecture/social/social-settings-architecture.md §3.B.
 */
export class CreateBrandKit1790800000000 implements MigrationInterface {
  name = 'CreateBrandKit1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "brand_kits" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        -- NULL = the agency's own kit. No synthetic "agency" uuid: a sentinel
        -- id would have to be excluded by hand from every join and would
        -- eventually be mistaken for a real client.
        "agency_client_id" uuid,
        "palette" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "typography" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "guidelines" text,
        "created_by_id" uuid,
        "updated_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_brand_kits" PRIMARY KEY ("id"),
        -- Structure is validated in the DTO layer; the database only insists
        -- these are collections, so a malformed write cannot make the column
        -- unreadable to every consumer at once.
        CONSTRAINT "CK_brand_kits_palette_array"
          CHECK (jsonb_typeof("palette") = 'array'),
        CONSTRAINT "CK_brand_kits_typography_array"
          CHECK (jsonb_typeof("typography") = 'array')
      )
    `);

    // One Brand Kit per agency context. WHERE agency_client_id IS NULL is what
    // makes this real — without the predicate, every NULL is distinct and the
    // agency scope is unprotected.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_brand_kits_agency_scope"
        ON "brand_kits" ("tenant_id", "workspace_id")
        WHERE "agency_client_id" IS NULL
    `);

    // One Brand Kit per managed client. Different clients in the same tenant
    // are independent rows and never collide.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_brand_kits_client_scope"
        ON "brand_kits" ("tenant_id", "workspace_id", "agency_client_id")
        WHERE "agency_client_id" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "brand_kit_assets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "brand_kit_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "kind" varchar(24) NOT NULL,
        "variant" varchar(24),
        "theme" varchar(16),
        -- Key in the PRIVATE bucket. Never projected to a client.
        "storage_path" varchar(512) NOT NULL,
        "mime_type" varchar(128) NOT NULL,
        "byte_size" bigint NOT NULL,
        "width" integer,
        "height" integer,
        "original_filename" varchar(255) NOT NULL,
        "checksum" char(64),
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_by_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "PK_brand_kit_assets" PRIMARY KEY ("id"),
        -- An asset has no meaning without its kit; deleting the kit takes the
        -- rows with it. The binaries are removed by the service, which is why
        -- kit deletion is not exposed as an endpoint in this phase.
        CONSTRAINT "FK_brand_kit_assets_kit"
          FOREIGN KEY ("brand_kit_id") REFERENCES "brand_kits" ("id")
          ON DELETE CASCADE,
        CONSTRAINT "CK_brand_kit_assets_kind"
          CHECK ("kind" IN ('logo', 'reference')),
        CONSTRAINT "CK_brand_kit_assets_variant"
          CHECK ("variant" IS NULL OR "variant" IN ('vertical', 'horizontal', 'mark')),
        CONSTRAINT "CK_brand_kit_assets_theme"
          CHECK ("theme" IS NULL OR "theme" IN ('light', 'dark')),
        -- variant/theme describe a logo's shape; a reference has no such axis,
        -- and allowing them there would create rows nothing knows how to read.
        CONSTRAINT "CK_brand_kit_assets_reference_shape"
          CHECK ("kind" <> 'reference' OR ("variant" IS NULL AND "theme" IS NULL)),
        CONSTRAINT "CK_brand_kit_assets_byte_size"
          CHECK ("byte_size" > 0)
      )
    `);

    // The list path: assets of one kit, filtered by kind.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_brand_kit_assets_kit"
        ON "brand_kit_assets" ("brand_kit_id", "kind")
    `);

    // The isolation path: every authorization check filters by scope.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_brand_kit_assets_scope"
        ON "brand_kit_assets" ("tenant_id", "workspace_id", "agency_client_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Assets first: they carry the FK to brand_kits, so dropping the parent
    // first would fail on the dependency.
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_brand_kit_assets_scope"',
    );
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_brand_kit_assets_kit"');
    await queryRunner.query('DROP TABLE IF EXISTS "brand_kit_assets"');

    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_brand_kits_client_scope"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "UQ_brand_kits_agency_scope"',
    );
    await queryRunner.query('DROP TABLE IF EXISTS "brand_kits"');
  }
}
