import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds a backward-compatible visual taxonomy to existing Brand Kit assets. */
export class ExpandBrandKitAssetContext1794200000000
  implements MigrationInterface
{
  name = 'ExpandBrandKitAssetContext1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "brand_kit_assets"
        ADD COLUMN IF NOT EXISTS "usage" varchar(16)
    `);
    await queryRunner.query(`
      UPDATE "brand_kit_assets"
         SET "usage" = CASE
           WHEN "kind" = 'reference' THEN 'reference'
           ELSE 'asset'
         END
       WHERE "usage" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "brand_kit_assets"
        ALTER COLUMN "usage" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "brand_kit_assets"
        DROP CONSTRAINT IF EXISTS "CK_brand_kit_assets_kind",
        DROP CONSTRAINT IF EXISTS "CK_brand_kit_assets_reference_shape",
        DROP CONSTRAINT IF EXISTS "CK_brand_kit_assets_kind_usage",
        DROP CONSTRAINT IF EXISTS "CK_brand_kit_assets_usage",
        DROP CONSTRAINT IF EXISTS "CK_brand_kit_assets_visual_shape"
    `);
    await queryRunner.query(`
      ALTER TABLE "brand_kit_assets"
        ADD CONSTRAINT "CK_brand_kit_assets_kind"
          CHECK ("kind" IN (
            'logo', 'product', 'person', 'environment', 'graphic_element',
            'texture', 'background', 'photo', 'reference'
          )),
        ADD CONSTRAINT "CK_brand_kit_assets_usage"
          CHECK ("usage" IN ('asset', 'reference')),
        ADD CONSTRAINT "CK_brand_kit_assets_kind_usage"
          CHECK (
            ("kind" = 'reference' AND "usage" = 'reference') OR
            ("kind" <> 'reference' AND "usage" = 'asset')
          ),
        ADD CONSTRAINT "CK_brand_kit_assets_visual_shape"
          CHECK (
            "kind" = 'logo' OR ("variant" IS NULL AND "theme" IS NULL)
          )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Refuse a rollback that would make newly categorized assets invalid.
    // No rows are deleted or rewritten to make the downgrade appear to work.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "brand_kit_assets"
           WHERE "kind" NOT IN ('logo', 'reference')
        ) THEN
          RAISE EXCEPTION 'Cannot roll back Brand Kit taxonomy while new kinds are in use';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE "brand_kit_assets"
        DROP CONSTRAINT IF EXISTS "CK_brand_kit_assets_kind_usage",
        DROP CONSTRAINT IF EXISTS "CK_brand_kit_assets_usage",
        DROP CONSTRAINT IF EXISTS "CK_brand_kit_assets_kind",
        DROP CONSTRAINT IF EXISTS "CK_brand_kit_assets_visual_shape",
        ADD CONSTRAINT "CK_brand_kit_assets_kind"
          CHECK ("kind" IN ('logo', 'reference')),
        ADD CONSTRAINT "CK_brand_kit_assets_reference_shape"
          CHECK (
            "kind" <> 'reference' OR
            ("variant" IS NULL AND "theme" IS NULL)
          )
    `);
    await queryRunner.query(`
      ALTER TABLE "brand_kit_assets" DROP COLUMN IF EXISTS "usage"
    `);
  }
}
