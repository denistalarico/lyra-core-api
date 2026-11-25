import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowCreativeLibraryDocuments1805900000001 implements MigrationInterface {
  name = 'AllowCreativeLibraryDocuments1805900000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_creative_assets"
        DROP CONSTRAINT "CK_social_creative_assets_type",
        ADD CONSTRAINT "CK_social_creative_assets_type"
          CHECK ("asset_type" IN ('image', 'video', 'document'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_creative_assets"
        DROP CONSTRAINT "CK_social_creative_assets_type",
        ADD CONSTRAINT "CK_social_creative_assets_type"
          CHECK ("asset_type" IN ('image', 'video'))
    `);
  }
}
