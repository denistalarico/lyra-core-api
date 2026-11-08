import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSocialCreativeAssetTrash1802600000000 implements MigrationInterface {
  name = 'AddSocialCreativeAssetTrash1802600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "social_creative_assets" ADD COLUMN IF NOT EXISTS "trashed_at" timestamptz`,
    );
    // Files deleted before the Lixeira existed were deleted for good.
    await queryRunner.query(
      `UPDATE "social_creative_assets" SET "trashed_at" = "deleted_at" WHERE "deleted_at" IS NOT NULL AND "trashed_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_creative_assets_trashed" ON "social_creative_assets" ("trashed_at") WHERE "trashed_at" IS NOT NULL AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_social_creative_assets_deleted" ON "social_creative_assets" ("deleted_at") WHERE "deleted_at" IS NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_social_creative_assets_deleted"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_social_creative_assets_trashed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "social_creative_assets" DROP COLUMN IF EXISTS "trashed_at"`,
    );
  }
}
